from __future__ import annotations

import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import unquote, urlparse

import boto3
from boto3.dynamodb.conditions import Key
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.httpsession import URLLib3Session

from agent import EXTRACT_SYSTEM, EXTRACT_TOOL, decide_turn, normalize_type, stamp_rewritten
from wording import (
    apply_footer_instruction,
    apply_lexical_footer,
    apply_lexical_wording,
    clauses_text_equal,
    desired_seller_label,
    instruction_satisfied,
    keep_unmodified,
)
from clauses import attach_new_extras, extra_from_extracted, extras_from_message, load_catalog, merge_extras
from compose import (
    COMPOSE_SYSTEM,
    COMPOSE_TOOL,
    REWRITE_SYSTEM,
    REWRITE_TOOL,
    compose_user_prompt,
    is_abusive_entry_request,
    is_auto_increase_request,
    is_repair_shift_request,
    is_self_help_request,
    merge_rewritten,
    parse_composed,
    parse_rewritten,
    retrieved_context,
    rewrite_user_prompt,
    validate_composed,
    wants_new_pact,
)

REGION = os.environ.get("REGION", "us-east-1")
# Default permanente: Haiku. Kimi K3 se enciende solo si USE_KIMI_NOW=1.
# Para volver a Haiku: USE_KIMI_NOW=0 en deploy.sh.
HAIKU_MODEL_ID = "us.anthropic.claude-3-5-haiku-20241022-v1:0"
KIMI_MODEL_ID = "us.moonshotai.kimi-k3"
USE_KIMI_NOW = os.environ.get("USE_KIMI_NOW", "0") == "1"
MODEL_ID = os.environ.get("MODEL_ID") or (KIMI_MODEL_ID if USE_KIMI_NOW else HAIKU_MODEL_ID)
FALLBACK_MODEL_ID = os.environ.get("FALLBACK_MODEL_ID") or HAIKU_MODEL_ID
VOICE_SYSTEM = (
    "Eres el chat de MiCasa. Hablas español de México, natural, breve y profesional, "
    "como un asesor de vivienda en Mérida, no como un formulario. "
    "Reescribe SOLO el tono del mensaje. No agregues cláusulas, artículos, montos, nombres ni ofertas. "
    "No sugieras mascotas, número de personas, fiestas ni ejemplos que el usuario no pidió. "
    "Si el original dice que NO se metió un cambio, no digas que ya lo aplicaste. "
    "Si el original cita un artículo, consérvalo. Sin markdown ni título. 2 a 4 frases."
)
ASK_SYSTEM = (
    "Eres el asistente legal de MiCasa, experto en arrendamiento y compraventa de vivienda en Yucatán, México. "
    "Respondes preguntas generales en español de México, claro y breve, citando artículos solo si vienen en el "
    "contexto recuperado y realmente responden el tema de la pregunta. Usa SOLO ese contexto; si no alcanza para "
    "responder, dilo y no inventes artículos ni cifras. Cuidado con palabras que se repiten en temas distintos del "
    "Código Civil: el 'depósito en garantía' o fianza de un arrendamiento (arts. 1619-1620) NO es lo mismo que el "
    "'contrato de depósito' de guarda de bienes muebles; responde según el tema real de la pregunta, no solo por "
    "coincidencia de palabras. Aquí NO redactas ni modificas contratos: si el usuario pide crear o cambiar un "
    "contrato, dile que abra o cree un borrador dentro de un proyecto para hacerlo ahí mismo. Sin markdown. 3 a 6 "
    "frases."
)

KB_ID = os.environ.get("KB_ID", "Q1UNTTTE8X")
TABLE = os.environ.get("DDB_TABLE", "micasa")
TOP_K = int(os.environ.get("TOP_K", "5"))
USER_ID = os.environ.get("USER_ID", "admin")

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(TABLE)
bedrock_runtime = boto3.client("bedrock-runtime", region_name=REGION)
session = boto3.Session(region_name=REGION)
http = URLLib3Session()

CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "content-type": "application/json",
}


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def pad_version(version: int) -> str:
    return f"v{version:04d}"


def parse_body(event: dict) -> dict:
    body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        import base64

        body = base64.b64decode(body).decode("utf-8")
    return json.loads(body or "{}")


def _json_default(value):
    # boto3 regresa los números de DynamoDB como Decimal; json no los serializa.
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    raise TypeError(f"Object of type {type(value)} is not JSON serializable")


def response(status: int, payload: dict) -> dict:
    return {
        "statusCode": status,
        "headers": CORS,
        "body": json.dumps(payload, ensure_ascii=False, default=_json_default),
    }


# ---------------------------------------------------------------------------
# Bedrock: retrieval (RAG) + converse helpers
# ---------------------------------------------------------------------------


def retrieve(query: str) -> tuple[list[dict], int]:
    started = time.perf_counter()
    creds = session.get_credentials().get_frozen_credentials()
    url = f"https://bedrock-agent-runtime.{REGION}.amazonaws.com/knowledgebases/{KB_ID}/retrieve"
    body = json.dumps(
        {
            "retrievalQuery": {"text": query},
            "retrievalConfiguration": {
                "managedSearchConfiguration": {"numberOfResults": TOP_K}
            },
        }
    )
    request = AWSRequest(
        method="POST",
        url=url,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    SigV4Auth(creds, "bedrock", REGION).add_auth(request)
    http_response = http.send(request.prepare())
    elapsed = int((time.perf_counter() - started) * 1000)
    if http_response.status_code >= 300:
        raise RuntimeError(f"Retrieve {http_response.status_code}: {http_response.text[:800]}")
    payload = json.loads(http_response.text or "{}")
    return payload.get("retrievalResults") or [], elapsed


def _result_score(result: dict) -> float | None:
    score = result.get("score")
    if score is None:
        return None
    return round(float(score), 4)


def source_name(result: dict) -> str:
    location = result.get("location") or {}
    uri = (
        (location.get("s3Location") or {}).get("uri")
        or (location.get("webLocation") or {}).get("url")
        or (result.get("metadata") or {}).get("x-amz-bedrock-kb-source-uri")
        or ""
    )
    if not uri:
        return "micasa-kb"
    path = unquote(urlparse(uri).path if "://" in str(uri) else str(uri))
    name = path.rstrip("/").split("/")[-1]
    return name or str(uri)


def _article_numbers(text: str) -> set[str]:
    return {
        match.group(1).replace(" ", "")
        for match in re.finditer(r"art[ií]culo\s+(\d+[A-Za-z]?(?:\s*(?:al?|-)\s*\d+)?)", text, re.I)
    }


def citations_for_answer(results: list[dict], answer: str, fallback: list[dict] | None = None) -> list[dict]:
    """Fuentes a mostrar junto a una respuesta.

    Antes se tomaba el primer "artículo N" que apareciera en cada fragmento
    recuperado, sin importar si ese número era el que realmente se usó en la
    respuesta. Eso producía chips de "fuentes" que citaban un artículo distinto
    al que el texto menciona (p. ej. el "depósito en garantía" de un
    arrendamiento, art. 1619, contra el "contrato de depósito" como guarda de
    bienes muebles, arts. 1683-1685: comparten la palabra "depósito" pero son
    temas distintos del Código Civil). Ahora solo mostramos un artículo si
    aparece a la vez en la respuesta del modelo y en el fragmento recuperado de
    esa fuente; si no hay coincidencia, mostramos la fuente sin inventarle un
    número de artículo.
    """
    cited = _article_numbers(answer)
    citations: list[dict] = []
    seen: set[tuple[str, str | None]] = set()

    if cited:
        for result in results:
            text = (result.get("content") or {}).get("text") or ""
            source = source_name(result)
            for article in sorted(_article_numbers(text) & cited):
                key = (source, article)
                if key in seen:
                    continue
                seen.add(key)
                item = {"source": source, "article": article}
                score = _result_score(result)
                if score is not None:
                    item["score"] = score
                citations.append(item)
        if citations:
            return citations[:4]

    for result in results:
        source = source_name(result)
        key = (source, None)
        if key in seen:
            continue
        seen.add(key)
        item = {"source": source}
        score = _result_score(result)
        if score is not None:
            item["score"] = score
        citations.append(item)
        if len(citations) >= 4:
            break
    return citations or (fallback or [])


def _converse_models() -> list[str]:
    models: list[str] = []
    for model_id in (
        MODEL_ID,
        FALLBACK_MODEL_ID,
        HAIKU_MODEL_ID,
        "us.amazon.nova-2-lite-v1:0",
    ):
        if model_id and model_id not in models:
            models.append(model_id)
    return models


def extract_facts(message: str, state: dict) -> tuple[dict, int]:
    started = time.perf_counter()
    known = json.dumps(
        {
            "contractType": state.get("contractType"),
            "slots": state.get("slots") or {},
            "currentVersion": state.get("currentVersion") or 0,
        },
        ensure_ascii=False,
    )
    result = None
    last_error = None
    for model_id in _converse_models():
        try:
            result = bedrock_runtime.converse(
                modelId=model_id,
                system=[{"text": EXTRACT_SYSTEM}],
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "text": (
                                    f"Estado actual:\n{known}\n\n"
                                    f"Mensaje del usuario:\n{message}"
                                )
                            }
                        ],
                    }
                ],
                inferenceConfig={"maxTokens": 600, "temperature": 0.0},
                toolConfig={
                    "tools": [EXTRACT_TOOL],
                    "toolChoice": {"tool": {"name": "apply_extracted_data"}},
                },
            )
            if model_id != MODEL_ID:
                print("extract_fallback_model", model_id)
            break
        except Exception as error:
            last_error = error
            print("extract_model_failed", model_id, error)
    if result is None:
        raise last_error or RuntimeError("No pude extraer datos")
    elapsed = int((time.perf_counter() - started) * 1000)
    extracted = {}
    for block in result.get("output", {}).get("message", {}).get("content", []):
        tool_use = block.get("toolUse") or {}
        if tool_use.get("name") == "apply_extracted_data":
            extracted = tool_use.get("input") or {}
            break
    if not extracted:
        print("extract_empty", json.dumps(result, default=str)[:1500])
    return extracted, elapsed


def converse(system: str, user: str, tools: list, tool_name: str, max_tokens: int, temperature: float) -> dict:
    last_error = None
    for model_id in _converse_models():
        try:
            result = bedrock_runtime.converse(
                modelId=model_id,
                system=[{"text": system}],
                messages=[{"role": "user", "content": [{"text": user}]}],
                inferenceConfig={"maxTokens": max_tokens, "temperature": temperature},
                toolConfig={
                    "tools": tools,
                    "toolChoice": {"tool": {"name": tool_name}},
                },
            )
            if model_id != MODEL_ID:
                print("converse_fallback_model", model_id, tool_name)
            return result
        except Exception as error:
            last_error = error
            print("converse_failed", model_id, tool_name, error)
    raise last_error or RuntimeError("No pude llamar al modelo")


def converse_text(system: str, user: str, max_tokens: int, temperature: float) -> dict:
    last_error = None
    for model_id in _converse_models():
        try:
            result = bedrock_runtime.converse(
                modelId=model_id,
                system=[{"text": system}],
                messages=[{"role": "user", "content": [{"text": user}]}],
                inferenceConfig={"maxTokens": max_tokens, "temperature": temperature},
            )
            if model_id != MODEL_ID:
                print("voice_fallback_model", model_id)
            return result
        except Exception as error:
            last_error = error
            print("voice_failed", model_id, error)
    raise last_error or RuntimeError("No pude llamar al modelo")


def voice_reply(original: str, user_message: str) -> str:
    text = (original or "").strip()
    if len(text) < 20:
        return original
    try:
        result = converse_text(
            VOICE_SYSTEM,
            f"Usuario:\n{user_message}\n\nBorrador:\n{text}",
            280,
            0.55,
        )
        spoken = ""
        for block in result.get("output", {}).get("message", {}).get("content", []):
            if block.get("text"):
                spoken += block["text"]
        spoken = re.sub(r"\s+", " ", spoken).strip()
        if 20 <= len(spoken) <= 900:
            return spoken
    except Exception as error:
        print("voice_skip", error)
    return original


def needs_composed_extra(message: str, extracted: dict, state: dict) -> bool:
    contract_type = normalize_type(extracted.get("contractType")) or state.get("contractType")
    if not contract_type:
        return False
    peek = dict(extracted)
    peek.pop("composedExtras", None)
    catalog = merge_extras(
        extras_from_message(message, contract_type),
        extra_from_extracted(peek, contract_type, message),
    )
    if catalog or is_self_help_request(message) or is_abusive_entry_request(message) or is_auto_increase_request(
        message
    ):
        return False
    return bool(
        extracted.get("needsCustomExtra")
        or extracted.get("extraClauseRequest")
        or wants_new_pact(message)
    )


def compose_extra_clauses(
    message: str,
    contract_type: str,
    existing: list,
    results: list[dict],
) -> list[dict]:
    prompt = compose_user_prompt(
        message,
        contract_type,
        existing,
        retrieved_context(results),
    )
    result = converse(COMPOSE_SYSTEM, prompt, [COMPOSE_TOOL], "apply_extra_clauses", 1200, 0.2)
    return validate_composed(parse_composed(result), contract_type, message)


def rewrite_document_clauses(
    message: str,
    contract_type: str,
    clauses: list,
    slots: dict,
) -> list:
    if not clauses:
        return []
    prompt = rewrite_user_prompt(message, contract_type, clauses, slots)
    result = converse(REWRITE_SYSTEM, prompt, [REWRITE_TOOL], "apply_rewritten_clauses", 4000, 0.1)
    return keep_unmodified(clauses, merge_rewritten(clauses, parse_rewritten(result)))


# ---------------------------------------------------------------------------
# DynamoDB access (single table, source of verdad real: proyectos > documentos > turnos)
# ---------------------------------------------------------------------------


def query_pk(pk: str, sk_prefix: str | None = None) -> list[dict]:
    items: list[dict] = []
    kwargs: dict = {"KeyConditionExpression": Key("pk").eq(pk)}
    if sk_prefix:
        kwargs["KeyConditionExpression"] = Key("pk").eq(pk) & Key("sk").begins_with(sk_prefix)
    last_key = None
    while True:
        if last_key:
            kwargs["ExclusiveStartKey"] = last_key
        page = table.query(**kwargs)
        items.extend(page.get("Items") or [])
        last_key = page.get("LastEvaluatedKey")
        if not last_key:
            break
    return items


def project_summary(item: dict) -> dict:
    return {
        "id": item["projectId"],
        "name": item.get("name") or "Proyecto",
        "createdAt": item.get("createdAt"),
        "updatedAt": item.get("updatedAt"),
    }


def document_summary(item: dict) -> dict:
    return {
        "id": item["docId"],
        "projectId": item["projectId"],
        "kind": item.get("kind") or "contract",
        "contractType": item.get("contractType"),
        "title": item.get("title") or "Nuevo borrador",
        "status": item.get("status") or "collecting",
        "currentVersion": int(item.get("currentVersion") or 0),
        "createdAt": item.get("createdAt"),
        "updatedAt": item.get("updatedAt"),
    }


def document_to_state(item: dict) -> dict:
    doc_id = item["docId"]
    return {
        "convId": doc_id,
        "contractType": item.get("contractType"),
        "title": item.get("title") or "Nuevo borrador",
        "slots": dict(item.get("slots") or {}),
        "pendingQuestions": list(item.get("pendingQuestions") or []),
        "pendingEvictionProposal": False,
        "documentId": doc_id,
        "currentVersion": int(item.get("currentVersion") or 0),
        "extraClauses": list(item.get("extraClauses") or []),
        "footer": dict(item.get("footer") or {}),
    }


def get_document_item(project_id: str, doc_id: str) -> dict | None:
    resp = table.get_item(Key={"pk": f"PROJECT#{project_id}", "sk": f"DOC#{doc_id}"})
    return resp.get("Item")


def get_version_item(project_id: str, doc_id: str, version: int) -> dict | None:
    if version <= 0:
        return None
    resp = table.get_item(
        Key={
            "pk": f"PROJECT#{project_id}#DOC#{doc_id}",
            "sk": f"VERSION#{pad_version(version)}",
        }
    )
    return resp.get("Item")


def turn_summary(item: dict) -> dict:
    return {
        "id": item.get("turnId"),
        "role": item.get("role"),
        "content": item.get("content"),
        "createdAt": item.get("createdAt"),
        "questions": item.get("questions") or [],
        "citations": item.get("citations") or [],
        "documentVersion": item.get("documentVersion"),
        "latencyMs": item.get("latencyMs"),
    }


def list_turns(project_id: str, doc_id: str) -> list[dict]:
    items = [
        item
        for item in query_pk(f"PROJECT#{project_id}#DOC#{doc_id}", "TURN#")
        if item.get("entityType") == "TURN"
    ]
    items.sort(key=lambda item: item.get("sk") or "")
    return [turn_summary(item) for item in items]


def document_detail(project_id: str, doc_id: str) -> dict | None:
    item = get_document_item(project_id, doc_id)
    if not item:
        return None
    version = int(item.get("currentVersion") or 0)
    version_item = get_version_item(project_id, doc_id, version)
    detail = document_summary(item)
    detail["slots"] = item.get("slots") or {}
    detail["pendingQuestions"] = item.get("pendingQuestions") or []
    detail["extraClauses"] = item.get("extraClauses") or []
    detail["footer"] = item.get("footer") or {}
    detail["clauses"] = (version_item or {}).get("clauses") or []
    detail["turns"] = list_turns(project_id, doc_id)
    return detail


def ask_summary(item: dict) -> dict:
    return {
        "id": item.get("askId"),
        "question": item.get("question"),
        "answer": item.get("answer"),
        "citations": item.get("citations") or [],
        "createdAt": item.get("createdAt"),
    }


def touch_project(project_id: str, ts: str | None = None) -> None:
    ts = ts or now_iso()
    try:
        table.update_item(
            Key={"pk": f"USER#{USER_ID}", "sk": f"PROJECT#{project_id}"},
            UpdateExpression="SET updatedAt=:ts, gsi1sk=:gsi1sk",
            ExpressionAttributeValues={":ts": ts, ":gsi1sk": f"UPDATED#{ts}#{project_id}"},
        )
    except Exception as error:
        print("touch_project_failed", project_id, error)


def save_document_state(project_id: str, doc_id: str, state: dict) -> None:
    status = "ready" if int(state.get("currentVersion") or 0) > 0 else "collecting"
    table.update_item(
        Key={"pk": f"PROJECT#{project_id}", "sk": f"DOC#{doc_id}"},
        UpdateExpression=(
            "SET contractType=:ct, title=:title, slots=:slots, pendingQuestions=:pq, "
            "extraClauses=:extras, footer=:footer, currentVersion=:cv, #st=:status, updatedAt=:ts"
        ),
        ExpressionAttributeNames={"#st": "status"},
        ExpressionAttributeValues={
            ":ct": state.get("contractType"),
            ":title": state.get("title"),
            ":slots": state.get("slots") or {},
            ":pq": state.get("pendingQuestions") or [],
            ":extras": state.get("extraClauses") or [],
            ":footer": state.get("footer") or {},
            ":cv": int(state.get("currentVersion") or 0),
            ":status": status,
            ":ts": now_iso(),
        },
    )


def save_version(project_id: str, doc_id: str, document: dict, clauses: list, contract_type: str | None) -> None:
    table.put_item(
        Item={
            "pk": f"PROJECT#{project_id}#DOC#{doc_id}",
            "sk": f"VERSION#{pad_version(document['version'])}",
            "entityType": "VERSION",
            "projectId": project_id,
            "docId": doc_id,
            "version": document["version"],
            "title": document["title"],
            "contractType": contract_type,
            "clauses": clauses,
            "createdAt": now_iso(),
        }
    )


def save_turn(project_id: str, doc_id: str, role: str, content: str, extra: dict | None = None) -> None:
    created = now_iso()
    turn_id = uid("turn")
    item = {
        "pk": f"PROJECT#{project_id}#DOC#{doc_id}",
        "sk": f"TURN#{created}#{turn_id}",
        "entityType": "TURN",
        "projectId": project_id,
        "docId": doc_id,
        "turnId": turn_id,
        "role": role,
        "content": content,
        "createdAt": created,
    }
    if extra:
        item.update(extra)
    table.put_item(Item=item)


def persist_turn(project_id: str, doc_id: str, message: str, turn: dict, metrics: dict) -> None:
    state = turn["nextState"]
    save_document_state(project_id, doc_id, state)
    save_turn(project_id, doc_id, "user", message)
    assistant_extra = {
        "latencyMs": metrics["latencyMs"],
        "questions": turn.get("questions") or [],
        "citations": turn.get("citations") or [],
    }
    if turn.get("document"):
        assistant_extra["documentVersion"] = turn["document"]["version"]
        save_version(project_id, doc_id, turn["document"], turn.get("clauses") or [], state.get("contractType"))
    save_turn(project_id, doc_id, "assistant", turn["text"], assistant_extra)
    touch_project(project_id)


def turn_response(doc_id: str, turn: dict, metrics: dict) -> dict:
    state = turn["nextState"]
    document = turn.get("document")
    patch = {
        "id": doc_id,
        "contractType": state.get("contractType"),
        "title": state.get("title"),
        "status": "ready" if int(state.get("currentVersion") or 0) > 0 else "collecting",
        "slots": state.get("slots") or {},
        "pendingQuestions": state.get("pendingQuestions") or [],
        "extraClauses": state.get("extraClauses") or [],
        "footer": state.get("footer") or {},
        "currentVersion": int(state.get("currentVersion") or 0),
    }
    # "clauses"/"version" solo se incluyen cuando este turno generó una versión nueva.
    # Si se omiten, el frontend conserva el documento que ya tenía en pantalla en vez
    # de reemplazarlo por una lista vacía.
    if document:
        patch["clauses"] = turn.get("clauses") or []
        patch["version"] = document["version"]
    return {
        "text": turn["text"],
        "questions": turn.get("questions") or [],
        "citations": turn.get("citations") or [],
        "metrics": metrics,
        "document": patch,
    }


# ---------------------------------------------------------------------------
# Rutas: proyectos
# ---------------------------------------------------------------------------


def list_projects(_params: list[str], _body: dict) -> dict:
    resp = table.query(
        IndexName="gsi1",
        KeyConditionExpression=Key("gsi1pk").eq(f"USER#{USER_ID}"),
        ScanIndexForward=False,
    )
    items = [item for item in (resp.get("Items") or []) if item.get("entityType") == "PROJECT"]
    return {"items": [project_summary(item) for item in items]}


def create_project(_params: list[str], body: dict) -> dict:
    name = (body.get("name") or "").strip() or "Proyecto sin nombre"
    project_id = uid("proj")
    created = now_iso()
    item = {
        "pk": f"USER#{USER_ID}",
        "sk": f"PROJECT#{project_id}",
        "gsi1pk": f"USER#{USER_ID}",
        "gsi1sk": f"UPDATED#{created}#{project_id}",
        "entityType": "PROJECT",
        "projectId": project_id,
        "name": name,
        "createdAt": created,
        "updatedAt": created,
    }
    table.put_item(Item=item)
    return project_summary(item)


# ---------------------------------------------------------------------------
# Rutas: documentos (borradores) dentro de un proyecto
# ---------------------------------------------------------------------------


def list_documents(params: list[str], _body: dict) -> dict:
    (project_id,) = params
    items = [item for item in query_pk(f"PROJECT#{project_id}", "DOC#") if item.get("entityType") == "DOCUMENT"]
    items.sort(key=lambda item: item.get("updatedAt") or "", reverse=True)
    return {"items": [document_summary(item) for item in items]}


def create_document(params: list[str], body: dict) -> dict:
    (project_id,) = params
    kind = (body.get("kind") or "contract").strip() or "contract"
    contract_type = normalize_type(body.get("contractType"))
    doc_id = uid("doc")
    created = now_iso()
    title = (body.get("title") or "").strip() or "Nuevo borrador"
    item = {
        "pk": f"PROJECT#{project_id}",
        "sk": f"DOC#{doc_id}",
        "entityType": "DOCUMENT",
        "projectId": project_id,
        "docId": doc_id,
        "kind": kind,
        "contractType": contract_type,
        "title": title,
        "status": "collecting",
        "slots": {},
        "pendingQuestions": [],
        "extraClauses": [],
        "currentVersion": 0,
        "createdAt": created,
        "updatedAt": created,
    }
    table.put_item(Item=item)
    touch_project(project_id, created)
    return document_summary(item)


def get_document(params: list[str], _body: dict) -> dict | None:
    project_id, doc_id = params
    detail = document_detail(project_id, doc_id)
    if not detail:
        raise ApiError(404, "Documento no encontrado")
    return detail


def _extras_from_applied(item: dict, clauses: list) -> list:
    contract_type = item.get("contractType")
    core_ids: set[str] = set()
    if contract_type:
        try:
            core_ids = {module["id"] for module in (load_catalog(contract_type).get("modules") or [])}
        except Exception as error:
            print("apply_core_ids_failed", error)
    previous = {extra.get("id"): extra for extra in item.get("extraClauses") or [] if extra.get("id")}
    extras: list[dict] = []
    for clause in clauses:
        clause_id = clause.get("id")
        if not clause_id or clause_id in core_ids:
            continue
        extras.append(
            previous.get(clause_id)
            or {
                "id": clause_id,
                "title": clause.get("title"),
                "articles": clause.get("articles") or [],
                "body": clause.get("body"),
            }
        )
    return extras


def apply_document(params: list[str], body: dict) -> dict:
    """Persiste el texto aceptado o editado a mano, sin pasar por el agente."""
    project_id, doc_id = params
    item = get_document_item(project_id, doc_id)
    if not item:
        raise ApiError(404, "Documento no encontrado")
    clauses = body.get("clauses")
    if not isinstance(clauses, list):
        raise ApiError(400, "Faltan cláusulas")
    version = int(item.get("currentVersion") or 0)
    if version <= 0:
        raise ApiError(409, "Aún no hay documento que editar")
    extras = _extras_from_applied(item, clauses)
    state = document_to_state(item)
    state["extraClauses"] = extras
    if isinstance(body.get("footer"), dict):
        state["footer"] = body["footer"]
    else:
        state["footer"] = item.get("footer") or {}
    if isinstance(body.get("slots"), dict):
        merged_slots = dict(state.get("slots") or {})
        merged_slots.update(body["slots"])
        state["slots"] = merged_slots
    save_version(
        project_id,
        doc_id,
        {"version": version, "title": item.get("title") or "Borrador"},
        clauses,
        item.get("contractType"),
    )
    save_document_state(project_id, doc_id, state)
    touch_project(project_id)
    detail = document_detail(project_id, doc_id)
    if not detail:
        raise ApiError(404, "Documento no encontrado")
    return detail


def post_turn(params: list[str], body: dict) -> dict:
    project_id, doc_id = params
    message = (body.get("message") or "").strip()
    if not message:
        raise ApiError(400, "Falta message")
    item = get_document_item(project_id, doc_id)
    if not item:
        raise ApiError(404, "Documento no encontrado")
    if (item.get("kind") or "contract") != "contract":
        raise ApiError(409, "Este tipo de documento todavía no soporta edición por chat.")

    state = document_to_state(item)
    started = time.perf_counter()
    extracted, extract_ms = extract_facts(message, state)
    retrieval_ms = 0
    retrieved: list[dict] = []
    contract_type = normalize_type(extracted.get("contractType")) or state.get("contractType")

    if needs_composed_extra(message, extracted, state) and contract_type:
        query = (
            "Código Civil del Estado de Yucatán artículo 1583 obligaciones del arrendatario "
            "uso convenido daños artículo 1629 rescisión falta de pago subarriendo "
        )
        if is_repair_shift_request(message):
            query += "artículo 1574 conservar predio vicios ocultos artículo 1618 obras habitabilidad "
        query += message
        try:
            retrieved, retrieval_ms = retrieve(query)
        except Exception as error:
            print("retrieve_failed", error)
        try:
            composed = compose_extra_clauses(message, contract_type, state.get("extraClauses") or [], retrieved)
            extracted["composedExtras"] = composed
        except Exception as error:
            print("compose_failed", error)
            extracted["composedExtras"] = []

    turn = decide_turn(state, extracted, message)
    version = int(item.get("currentVersion") or 0)
    current_clauses = (get_version_item(project_id, doc_id, version) or {}).get("clauses") or []
    contract_type = turn["nextState"].get("contractType") or contract_type
    slots_now = turn["nextState"].get("slots") or {}
    footer_patch, footer_note = apply_footer_instruction(
        message, turn["nextState"].get("footer"), slots_now, contract_type
    )
    if footer_patch:
        turn["nextState"]["footer"] = apply_lexical_footer(message, footer_patch, slots_now)
        if footer_patch.get("leftName"):
            key = "arrendador" if contract_type == "renta" else "vendedor"
            slots_now[key] = footer_patch["leftName"]
        if footer_patch.get("rightName"):
            key = "arrendatario" if contract_type == "renta" else "comprador"
            slots_now[key] = footer_patch["rightName"]
        turn["nextState"]["slots"] = slots_now
    else:
        turn["nextState"]["footer"] = apply_lexical_footer(
            message, turn["nextState"].get("footer"), slots_now
        )
    skip_rewrite = bool(footer_note) and not desired_seller_label(message, slots_now)
    if (turn.get("needsRewrite") or turn.get("document")) and not skip_rewrite:
        starting = turn.get("clauses") if turn.get("document") and not turn.get("needsRewrite") else current_clauses
        starting = attach_new_extras(starting or [], turn["nextState"].get("extraClauses") or [])
        proven = apply_lexical_wording(message, starting or [], slots_now) or []
        if proven:
            proven = keep_unmodified(starting, proven)
        if not proven or not instruction_satisfied(message, proven, slots_now):
            try:
                rewritten = rewrite_document_clauses(
                    message,
                    contract_type,
                    starting or [],
                    slots_now,
                )
            except Exception as error:
                print("rewrite_failed", error)
                rewritten = []
            rewritten = keep_unmodified(starting, rewritten) if rewritten else []
            if (
                rewritten
                and not clauses_text_equal(current_clauses, rewritten)
                and instruction_satisfied(message, rewritten, slots_now)
            ):
                proven = rewritten
            elif proven and not clauses_text_equal(current_clauses, proven):
                pass
            elif not clauses_text_equal(current_clauses, starting):
                proven = starting
            else:
                proven = []
        if proven and not clauses_text_equal(current_clauses, proven):
            if turn.get("document"):
                turn["clauses"] = proven
            else:
                document, clauses = stamp_rewritten(turn["nextState"], proven)
                turn["document"] = document
                turn["clauses"] = clauses
            version_label = (turn.get("document") or {}).get("version") or turn["nextState"].get("currentVersion")
            turn["text"] = (
                f"Dejé el cambio en la versión {version_label}. "
                "Revisa el documento: acepta o descarta cada parte."
            )
        elif turn.get("needsRewrite") and not footer_note:
            turn["document"] = None
            turn["clauses"] = []
            turn["text"] = (
                "No pude dejar ese cambio en el texto del contrato. "
                "Dime las palabras exactas que deben quedar y las que hay que quitar."
            )
    if footer_note and not turn.get("document"):
        turn["text"] = footer_note
    missing_only = bool(turn.get("questions")) and not turn.get("document")
    if not missing_only and not turn.get("document") and not footer_note:
        turn["text"] = voice_reply(turn.get("text") or "", message)

    if not retrieved:
        next_contract_type = turn["nextState"].get("contractType")
        query = None
        if next_contract_type == "renta":
            query = (
                "Código Civil del Estado de Yucatán arrendamiento casa habitación "
                "artículos 1564 1573 1574 1619 1620 depósito fianza"
            )
        elif next_contract_type == "venta":
            query = (
                "Código Civil del Estado de Yucatán compraventa inmueble "
                "artículo 1397 escritura pública INSEJUPY NOM-247-SE-2021"
            )
        if query and (turn.get("document") or turn.get("questions")):
            try:
                retrieved, retrieval_ms = retrieve(query)
            except Exception as error:
                print("retrieve_failed", error)

    turn["citations"] = citations_for_answer(retrieved, turn.get("text") or "", turn.get("fallbackCitations"))
    latency_ms = int((time.perf_counter() - started) * 1000)
    metrics = {"latencyMs": latency_ms, "ttftMs": extract_ms, "retrievalMs": retrieval_ms}

    try:
        persist_turn(project_id, doc_id, message, turn, metrics)
    except Exception as error:
        print("persist_failed", error)

    return turn_response(doc_id, turn, metrics)


# ---------------------------------------------------------------------------
# Rutas: asistente legal libre (RAG puro, no toca documentos)
# ---------------------------------------------------------------------------


def thread_summary(item: dict) -> dict:
    return {
        "id": item["threadId"],
        "title": item.get("title") or "Nueva consulta",
        "createdAt": item.get("createdAt"),
        "updatedAt": item.get("updatedAt"),
    }


def _ask_items(project_id: str) -> list[dict]:
    return [item for item in query_pk(f"PROJECT#{project_id}", "ASK#") if item.get("entityType") == "ASK"]


def _thread_asks(project_id: str, thread_id: str) -> list[dict]:
    items = _ask_items(project_id)
    if thread_id == "legacy":
        return [item for item in items if not item.get("threadId")]
    return [item for item in items if item.get("threadId") == thread_id]


def list_ask_threads(params: list[str], _body: dict) -> dict:
    (project_id,) = params
    threads = [item for item in query_pk(f"PROJECT#{project_id}", "THREAD#") if item.get("entityType") == "ASK_THREAD"]
    threads.sort(key=lambda item: item.get("updatedAt") or "", reverse=True)
    items = [thread_summary(item) for item in threads]
    legacy = _thread_asks(project_id, "legacy")
    if legacy:
        legacy.sort(key=lambda item: item.get("createdAt") or item.get("sk") or "")
        items.append(
            {
                "id": "legacy",
                "title": (legacy[0].get("question") or "Conversación")[:72],
                "createdAt": legacy[0].get("createdAt"),
                "updatedAt": legacy[-1].get("createdAt"),
            }
        )
    return {"items": items}


def create_ask_thread(params: list[str], body: dict) -> dict:
    (project_id,) = params
    thread_id = uid("askth")
    created = now_iso()
    title = (body.get("title") or "").strip() or "Nueva consulta"
    item = {
        "pk": f"PROJECT#{project_id}",
        "sk": f"THREAD#{thread_id}",
        "entityType": "ASK_THREAD",
        "projectId": project_id,
        "threadId": thread_id,
        "title": title,
        "createdAt": created,
        "updatedAt": created,
    }
    table.put_item(Item=item)
    return thread_summary(item)


def list_ask_entries(params: list[str], _body: dict) -> dict:
    project_id, thread_id = params
    items = _thread_asks(project_id, thread_id)
    items.sort(key=lambda item: item.get("createdAt") or item.get("sk") or "")
    return {"items": [ask_summary(item) for item in items]}


def delete_ask_thread(params: list[str], _body: dict) -> dict:
    project_id, thread_id = params
    for item in _thread_asks(project_id, thread_id):
        table.delete_item(Key={"pk": item["pk"], "sk": item["sk"]})
    if thread_id != "legacy":
        table.delete_item(Key={"pk": f"PROJECT#{project_id}", "sk": f"THREAD#{thread_id}"})
    return {"ok": True}


def clear_ask_thread(params: list[str], _body: dict) -> dict:
    project_id, thread_id = params
    for item in _thread_asks(project_id, thread_id):
        table.delete_item(Key={"pk": item["pk"], "sk": item["sk"]})
    return {"ok": True}


_ASK_RENTA_HINTS = ("renta", "arrend", "inquilin", "vivienda", "habitaci", "desaloj", "fianza")
_ASK_VENTA_HINTS = ("compra", "venta", "vendedor", "comprador", "escritura", "terreno", "predio")
_DEPOSIT_GOODS_RE = re.compile(r"depositari[oa]|depositante|bajo llave|cerradura o costura")
_RENTAL_CONTEXT_RE = re.compile(r"arrend|inquilin|fianza|garant[ií]a|habitaci|1619|1620")


def _is_rental_deposit_question(question: str) -> bool:
    lowered = question.lower()
    mentions_deposit = "depósito" in lowered or "deposito" in lowered or "fianza" in lowered
    mentions_rent = any(hint in lowered for hint in ("renta", "arrend", "inquilin", "vivienda", "habitaci"))
    return mentions_deposit and mentions_rent


def _expand_ask_query(question: str) -> str:
    """Amplía la pregunta libre con vocabulario del Código Civil antes de mandarla
    al Knowledge Base. Sin esto, preguntas como "depósito en renta de vivienda"
    recuperaban por similitud léxica el capítulo de "contrato de depósito"
    (guarda de bienes muebles) en vez del depósito en garantía del arrendamiento,
    porque ambos usan la misma palabra "depósito" para temas distintos.
    """
    lowered = question.lower()
    is_venta = any(hint in lowered for hint in _ASK_VENTA_HINTS)
    is_renta = any(hint in lowered for hint in _ASK_RENTA_HINTS)
    if _is_rental_deposit_question(question):
        return (
            f"{question} Código Civil del Estado de Yucatán, arrendamiento de casa habitación. "
            "Depósito en garantía o fianza que entrega el inquilino al arrendador, artículo 1619. "
            "No uses el contrato de depósito de bienes muebles ni a depositario o depositante."
        )
    if is_renta and not is_venta:
        return (
            f"{question} Código Civil del Estado de Yucatán, capítulo de arrendamiento de casa "
            "habitación. Renta, plazo, depósito en garantía y rescisión por falta de pago, "
            "artículos 1571 a 1574, 1619, 1620 y 1629."
        )
    if is_venta and not is_renta:
        return (
            f"{question} Código Civil del Estado de Yucatán, capítulo de compraventa de "
            "inmuebles, escritura pública e inscripción en el Registro Público de la Propiedad, "
            "artículo 1397."
        )
    return f"{question} Código Civil del Estado de Yucatán."


def _filter_ask_results(question: str, results: list[dict]) -> list[dict]:
    """Si la pregunta es sobre el depósito de una renta, descarta fragmentos del
    contrato de depósito de bienes (depositario/depositante) que el KB suele
    devolver por la palabra 'depósito'."""
    if not results or not _is_rental_deposit_question(question):
        return results
    kept: list[dict] = []
    for result in results:
        text = ((result.get("content") or {}).get("text") or "")
        if _DEPOSIT_GOODS_RE.search(text) and not _RENTAL_CONTEXT_RE.search(text):
            continue
        kept.append(result)
    return kept or results


def _rag_answer(question: str) -> dict:
    """Retrieve top-k + generar. Lo usan el asistente y POST /query."""
    started = time.perf_counter()
    retrieved: list[dict] = []
    retrieval_ms = 0
    try:
        retrieved, retrieval_ms = retrieve(_expand_ask_query(question))
        retrieved = _filter_ask_results(question, retrieved)
    except Exception as error:
        print("ask_retrieve_failed", error)

    context = retrieved_context(retrieved)
    extra_hint = ""
    if _is_rental_deposit_question(question):
        extra_hint = (
            "\n\nNota: la pregunta se refiere al depósito en garantía del arrendamiento "
            "(art. 1619 del Código Civil de Yucatán), no al contrato de depósito de bienes."
        )
    answer = ""
    try:
        result = converse_text(
            ASK_SYSTEM,
            f"Contexto legal recuperado:\n{context}\n\nPregunta del usuario:\n{question}{extra_hint}",
            700,
            0.2,
        )
        for block in result.get("output", {}).get("message", {}).get("content", []):
            if block.get("text"):
                answer += block["text"]
        answer = re.sub(r"\s+", " ", answer).strip()
    except Exception as error:
        print("ask_failed", error)
    if not answer:
        answer = "No pude responder con las fuentes disponibles. Intenta reformular la pregunta."

    citations = citations_for_answer(retrieved, answer)
    latency_ms = int((time.perf_counter() - started) * 1000)
    abstained = "no pude responder con las fuentes" in answer.lower()
    retrieved_out = [
        {"source": source_name(item), "score": _result_score(item)}
        for item in retrieved
    ]
    return {
        "answer": answer,
        "citations": citations,
        "retrieved": retrieved_out,
        "retrievedCount": len(retrieved),
        "metrics": {"latencyMs": latency_ms, "retrievalMs": retrieval_ms},
        "abstained": abstained,
    }


def get_health(_params: list[str], _body: dict) -> dict:
    return {
        "ok": True,
        "service": "micasa-chat",
        "index": "bedrock-knowledge-base",
        "kbId": KB_ID,
        "model": MODEL_ID,
        "fallbackModel": FALLBACK_MODEL_ID,
        "topK": TOP_K,
        "region": REGION,
    }


def post_query(_params: list[str], body: dict) -> dict:
    question = (body.get("question") or body.get("query") or "").strip()
    if not question:
        raise ApiError(400, "Falta question")
    rag = _rag_answer(question)
    return {
        "question": question,
        "answer": rag["answer"],
        "citations": rag["citations"],
        "retrieved": rag["retrieved"],
        "k": TOP_K,
        "retrievedCount": rag["retrievedCount"],
        "abstained": rag["abstained"],
        "metrics": rag["metrics"],
    }


def post_ingest(_params: list[str], _body: dict) -> dict:
    return {
        "ok": True,
        "ingested": False,
        "message": (
            "La ingestión no corre en este POST: se sube el PDF a s3://micasa-kb-source/ "
            "y se lanza Sync en la Knowledge Base. Equivale a POST /ingest del enunciado."
        ),
        "bucket": "micasa-kb-source",
        "kbId": KB_ID,
    }


def post_ask_in_thread(params: list[str], body: dict) -> dict:
    project_id, thread_id = params
    question = (body.get("question") or "").strip()
    if not question:
        raise ApiError(400, "Falta question")

    rag = _rag_answer(question)
    answer = rag["answer"]
    citations = rag["citations"]
    retrieval_ms = rag["metrics"]["retrievalMs"]
    latency_ms = rag["metrics"]["latencyMs"]
    created = now_iso()
    ask_id = uid("ask")
    try:
        table.put_item(
            Item={
                "pk": f"PROJECT#{project_id}",
                "sk": f"ASK#{created}#{ask_id}",
                "entityType": "ASK",
                "projectId": project_id,
                "threadId": thread_id,
                "askId": ask_id,
                "question": question,
                "answer": answer,
                "citations": citations,
                "createdAt": created,
            }
        )
    except Exception as error:
        print("ask_persist_failed", error)

    if thread_id != "legacy":
        try:
            current = table.get_item(Key={"pk": f"PROJECT#{project_id}", "sk": f"THREAD#{thread_id}"}).get("Item")
            if current:
                values: dict = {":ts": created}
                expression = "SET updatedAt=:ts"
                if (current.get("title") or "Nueva consulta") == "Nueva consulta":
                    expression += ", title=:title"
                    values[":title"] = question[:72]
                table.update_item(
                    Key={"pk": f"PROJECT#{project_id}", "sk": f"THREAD#{thread_id}"},
                    UpdateExpression=expression,
                    ExpressionAttributeValues=values,
                )
        except Exception as error:
            print("ask_touch_thread_failed", error)

    return {
        "id": ask_id,
        "question": question,
        "answer": answer,
        "citations": citations,
        "createdAt": created,
        "metrics": {"latencyMs": latency_ms, "retrievalMs": retrieval_ms},
    }


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

ROUTES: list[tuple[re.Pattern, dict[str, object]]] = [
    (re.compile(r"^/health$"), {"GET": get_health}),
    (re.compile(r"^/query$"), {"POST": post_query}),
    (re.compile(r"^/ingest$"), {"POST": post_ingest}),
    (re.compile(r"^/projects$"), {"GET": list_projects, "POST": create_project}),
    (
        re.compile(r"^/projects/([^/]+)/documents$"),
        {"GET": list_documents, "POST": create_document},
    ),
    (re.compile(r"^/projects/([^/]+)/documents/([^/]+)$"), {"GET": get_document, "PUT": apply_document}),
    (re.compile(r"^/projects/([^/]+)/documents/([^/]+)/turns$"), {"POST": post_turn}),
    (re.compile(r"^/projects/([^/]+)/ask$"), {"GET": list_ask_threads, "POST": create_ask_thread}),
    (
        re.compile(r"^/projects/([^/]+)/ask/([^/]+)/entries$"),
        {"GET": list_ask_entries, "DELETE": clear_ask_thread},
    ),
    (
        re.compile(r"^/projects/([^/]+)/ask/([^/]+)$"),
        {"GET": list_ask_entries, "POST": post_ask_in_thread, "DELETE": delete_ask_thread},
    ),
]


def handler(event, _context):
    http_ctx = (event.get("requestContext") or {}).get("http") or {}
    method = http_ctx.get("method") or event.get("httpMethod") or "GET"
    if method == "OPTIONS":
        return response(204, {})

    path = http_ctx.get("path") or event.get("rawPath") or "/"
    path = path.rstrip("/") or "/"

    body: dict = {}
    if method in ("POST", "PUT", "PATCH"):
        try:
            body = parse_body(event)
        except Exception:
            return response(400, {"error": "JSON inválido"})

    for pattern, methods in ROUTES:
        match = pattern.match(path)
        if not match:
            continue
        fn = methods.get(method)
        if not fn:
            return response(405, {"error": "Método no permitido"})
        try:
            result = fn(list(match.groups()), body)  # type: ignore[operator]
            if result is None:
                return response(404, {"error": "No encontrado"})
            return response(200, result)
        except ApiError as error:
            return response(error.status, {"error": error.message})
        except Exception as error:
            print("handler_failed", path, error)
            return response(500, {"error": "No pude procesar la solicitud."})

    return response(404, {"error": "Ruta no encontrada"})
