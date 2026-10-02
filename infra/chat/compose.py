from __future__ import annotations

import json
import re
import unicodedata

from clauses import build_extra, load_catalog

RESERVED_IDS = {
    "comparecencia",
    "declaraciones-arrendador",
    "declaraciones-arrendatario",
    "declaraciones-vendedor",
    "declaraciones-comprador",
    "objeto",
    "uso",
    "vigencia",
    "renta-pago",
    "deposito",
    "servicios",
    "conservacion",
    "terminacion",
    "jurisdiccion",
    "precio",
    "estado",
    "escritura",
    "inventario",
    "gastos",
}

FORBIDDEN = (
    "vía de hecho",
    "via de hecho",
    "desalojo extrajudicial",
    "tomar la justicia",
    "cerrajero",
    "cambiar la chapa",
    "cambiar cerradura",
    "ingreso forzoso",
    "allanamiento",
    "despojo",
    "sacar las cosas",
    "retirar bienes",
    "retirar las cosas",
    "cortar el agua",
    "corta el agua",
    "cortar la luz",
    "corta la luz",
    "cortar el gas",
    "corte de servicio",
    "corte de agua",
    "corte de luz",
    "rescision automatica",
    "rescision inmediata",
    "candado",
    "bloquear la reja",
    "bloquear reja",
)

DISCRIM_MARKERS = (
    "nino",
    "nina",
    "menor",
    "bebe",
    "infante",
    "nacionalidad",
    "extranjer",
    "discapac",
)

SELF_HELP_MARKERS = (
    "cerrajero",
    "cambiar la chapa",
    "cambiar chapa",
    "cambiar cerradura",
    "entrar por la fuerza",
    "ingreso forzoso",
    "sacar las cosas",
    "retirar bienes",
    "retirar las cosas",
    "cortar el agua",
    "corta el agua",
    "cortar la luz",
    "corta la luz",
    "cortar el gas",
    "corta el gas",
    "cortar los servicios",
    "corte de servicio",
    "corte de agua",
    "corte de luz",
    "desalojo inmediato",
    "desalojar sin",
    "via de hecho",
    "candado",
    "bloquear la reja",
    "bloquear reja",
    "cambiar candado",
)

REPAIR_PAY_MARKERS = (
    "pague",
    "pagar",
    "cargo del arrendatario",
    "cuenta del inquilino",
    "inquilino cubr",
    "arrendatario cubr",
    "pague todo",
)
REPAIR_TOPIC_MARKERS = (
    "repar",
    "filtr",
    "gotera",
    "techo",
    "vicio",
    "estructur",
    "humedad",
    "lluvia",
    "huracan",
)
STRUCTURAL_BODY_MARKERS = (
    "filtracion",
    "gotera",
    "vicio oculto",
    "huracan",
    "sismo",
    "lluvia",
    "estructural",
    "desastre",
)
LANDLORD_DUTY_MARKERS = (
    "arrendador",
    "conserv",
    "vicio",
    "defect",
    "goce pacifico",
    "entreg",
)

TENANT_CITES = ("1583", "1629", "1645", "1618")

COMPOSE_TOOL = {
    "toolSpec": {
        "name": "apply_extra_clauses",
        "description": (
            "Propone una o dos cláusulas adicionales nuevas. "
            "No reescribe el contrato base ni copie cláusulas que ya existan."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "required": ["clauses"],
                "properties": {
                    "clauses": {
                        "type": "array",
                        "maxItems": 2,
                        "items": {
                            "type": "object",
                            "required": ["id", "title", "body"],
                            "properties": {
                                "id": {"type": "string"},
                                "title": {"type": "string"},
                                "articles": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                },
                                "body": {"type": "string"},
                            },
                        },
                    }
                },
            }
        },
    }
}

COMPOSE_SYSTEM = (
    "Redactas SOLO cláusulas adicionales para un contrato de vivienda en Yucatán. "
    "El contrato base ya está fijado en plantilla; no lo reescribas. "
    "Imita el tono y el formato de los ejemplos. "
    "Para obligaciones o rescisión del ARRENDATARIO cita 1583 (I, II o III) y/o 1629 (I, II o III). "
    "1564 solo define el arrendamiento. "
    "1574 son obligaciones del ARRENDADOR (entregar, conservar, no estorbar, goce pacífico, vicios ocultos). "
    "Úsalo solo para delimitar lo que no puede pasarse al inquilino. "
    "No inventes artículos. Si no está en el contexto legal, no lo cites. "
    "Nunca prohíbas niños, menores, familias, nacionalidad o discapacidad. "
    "Si el usuario pide eso, redacta ocupación máxima y uso habitacional, sin mencionar edad. "
    "Si pide que el inquilino pague todas las reparaciones o filtraciones, limita al deterioro menor por uso (1583-II) "
    "y deja estructura, vicios ocultos y causas naturales al arrendador (1574-II y V). "
    "Si pide cerrajero, cambio de cerraduras, retiro de bienes, corte de agua/luz/gas o desalojo por vía de hecho, "
    "NO redactes esa acción. No llames la herramienta. "
    "No uses 'rescisión automática' ni 'rescisión inmediata'. "
    "La rescisión se solicita ante las instancias competentes (1629). "
    "Si pide intereses diarios altos, recargos punitivos o cambio de candados, no copies el porcentaje ni inventes otra tasa. "
    "No pactes usura. La falta de pago habitacional se rescinde a los tres meses (1629-I). "
    "Si pide que paguen el valor de la casa por drogas o extinción de dominio, no redactes esa multa ni cites 1583 como si fuera esa materia. "
    "Destino lícito y rescisión por uso distinto (1583-III, 1629-II). El contrato escrito (1573) y su ratificación, no una sanción utópica. "
    "Si pide entrar sin aviso, de noche o cuando quiera, NO redactes esa facultad. La inspección ya está en el contrato base. "
    "Si pide aumento automático de renta cada dos o tres meses, NO lo redactes. "
    "No copies ejemplos de ocupación, mascotas o fiestas si el usuario no los pidió. "
    "Redacta solo el pacto que pidió. "
    "Llama apply_extra_clauses solo si hay un pacto lícito que redactar."
)


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn").lower()


def is_discriminatory_request(message: str) -> bool:
    text = _fold(message)
    if not any(marker in text for marker in DISCRIM_MARKERS):
        return False
    return any(token in text for token in ("no ", "sin ", "prohib", "impedir", "vetar"))


def is_self_help_request(message: str) -> bool:
    text = _fold(message)
    return any(marker in text for marker in SELF_HELP_MARKERS)


def is_repair_shift_request(message: str) -> bool:
    text = _fold(message)
    return any(marker in text for marker in REPAIR_PAY_MARKERS) and any(
        marker in text for marker in REPAIR_TOPIC_MARKERS
    )


def _daily_percent(text: str) -> float | None:
    match = re.search(r"(\d+(?:[.,]\d+)?)\s*%\s*(?:diario|al dia)", text)
    if not match:
        match = re.search(r"(\d+(?:[.,]\d+)?)\s*por ciento\s*(?:diario|al dia)", text)
    if not match:
        return None
    return float(match.group(1).replace(",", "."))


def is_usury_request(message: str) -> bool:
    text = _fold(message)
    if "usura" in text:
        return True
    if re.search(r"(diez|10)\s*(%|por ciento)\s*(diario|al dia)", text):
        return True
    daily = _daily_percent(text)
    if daily is not None and daily >= 1:
        return True
    monthly = re.search(r"(\d+(?:[.,]\d+)?)\s*%\s*mensual", text)
    if monthly and float(monthly.group(1).replace(",", ".")) >= 15:
        return True
    return False


def is_forfeiture_request(message: str) -> bool:
    text = _fold(message)
    return any(
        marker in text
        for marker in (
            "droga",
            "narco",
            "extinc",
            "ilicito",
            "delincuen",
            "fiscalia",
            "aseguramiento",
        )
    )


def is_abusive_entry_request(message: str) -> bool:
    text = _fold(message)
    entry = any(marker in text for marker in ("inspeccion", "entrar", "ingresar"))
    abusive = any(
        marker in text
        for marker in ("sin aviso", "cuando quiera", "cualquier momento", "de noche", "sin previo")
    )
    return entry and abusive


def is_auto_increase_request(message: str) -> bool:
    text = _fold(message)
    topic = "renta" in text and any(
        marker in text for marker in ("increment", "suba", "aument", "revision")
    )
    auto = any(
        marker in text
        for marker in ("automatic", "cada 3", "cada tres", "cada 2", "cada dos", "trimestr")
    )
    return topic and auto


def wants_new_pact(message: str) -> bool:
    if is_self_help_request(message) or is_abusive_entry_request(message) or is_auto_increase_request(message):
        return False
    text = _fold(message)
    asks = any(
        token in text
        for token in (
            "agrega",
            "agregue",
            "anade",
            "incluye",
            "estipul",
            "clausula",
            "pacto",
        )
    )
    topic = any(
        token in text
        for token in (
            "persona",
            "ocupa",
            "habitante",
            "fiesta",
            "reunion",
            "evento",
            "ruido",
            "visita",
            "fumar",
            "airbnb",
            "huesped",
            "invitad",
            "nino",
            "menor",
            "repar",
            "filtr",
            "gotera",
            "abandono",
            "mora",
            "recargo",
            "droga",
            "extinc",
        )
    )
    limit = any(token in text for token in ("maximo", "hasta", "prohib", "no ", "sin "))
    return asks or (topic and limit)


def _slug(title: str) -> str:
    folded = _fold(title)
    slug = re.sub(r"[^a-z0-9]+", "-", folded).strip("-")[:36]
    return slug or "pacto-adicional"


def _example_block(contract_type: str, message: str = "") -> str:
    extras = load_catalog("extras")
    folded = _fold(message)
    lines = []
    for item in extras.get("items") or []:
        needles = item.get("match") or []
        if folded and needles and not any(needle in folded for needle in needles):
            continue
        variants = item.get("variants") or {}
        for variant in variants.values():
            body = variant.get(contract_type) or variant.get("renta")
            if body:
                lines.append(f"{item.get('title')}: {body[:420]}")
                break
    core = load_catalog(contract_type if contract_type in {"renta", "venta"} else "renta")
    numbered = [
        module
        for module in (core.get("modules") or [])
        if re.search(r"PRIMERA|SEGUNDA|SÉPTIMA|NOVENA", module.get("title") or "", re.I)
    ]
    for module in (numbered or core.get("modules") or [])[:2]:
        lines.append(f"{module.get('title')}: {(module.get('body') or '')[:220]}")
    return "\n".join(lines[:4])


def retrieved_context(results: list[dict]) -> str:
    chunks = []
    try:
        for item in load_catalog("citas").get("renta") or []:
            chunks.append(f"Art. {item.get('article')} ({item.get('role')}): {item.get('text')}")
    except Exception:
        chunks.append(
            "Art. 1583: obligaciones del arrendatario (pago, daños, uso convenido). "
            "Art. 1629: rescisión (falta de pago, uso contrario a 1583-III, subarriendo). "
            "Art. 1574: el arrendador conserva el predio y responde de vicios ocultos."
        )
    for result in results[:5]:
        text = ((result.get("content") or {}).get("text") or "").strip()
        if text:
            chunks.append(text[:900])
    return "\n---\n".join(chunks)


def _mentions_landlord_duty(folded: str) -> bool:
    return any(marker in folded for marker in LANDLORD_DUTY_MARKERS)


def _shifts_structure_to_tenant(folded: str) -> bool:
    if not any(marker in folded for marker in STRUCTURAL_BODY_MARKERS):
        return False
    tenant_pays = any(
        token in folded
        for token in (
            "por cuenta del arrendatario",
            "cargo del arrendatario",
            "el arrendatario pag",
            "el inquilino pag",
            "el arrendatario cubr",
        )
    )
    if not tenant_pays:
        return False
    keeps_landlord = "1574" in folded or (
        "arrendador" in folded and any(token in folded for token in ("conserv", "estructur", "vicio"))
    )
    return not keeps_landlord


def _is_usury_body(folded: str) -> bool:
    if re.search(r"(diez|10)\s*(%|por ciento)\s*(diario|al dia)", folded):
        return True
    daily = _daily_percent(folded)
    return daily is not None and daily >= 1


def _is_abusive_entry_body(folded: str) -> bool:
    entry = any(marker in folded for marker in ("inspeccion", "ingresar", "entrar"))
    abusive = any(
        marker in folded
        for marker in ("sin aviso", "cualquier momento", "de noche", "cuando quiera", "sin previo")
    )
    return entry and abusive


def _is_auto_increase_body(folded: str) -> bool:
    return any(marker in folded for marker in ("increment", "aument")) and any(
        marker in folded for marker in ("automatic", "cada 3", "cada tres", "trimestr")
    )


def _is_forfeiture_penalty_body(folded: str) -> bool:
    if "no se pacta" in folded and "valor comercial" in folded:
        return False
    return "valor comercial" in folded and any(
        token in folded for token in ("pague", "pagar", "exig", "multa", "sancion", "cinco dia", "5 dia")
    )


def _soften_rescission(body: str) -> str:
    body = re.sub(
        r"rescisi[oó]n\s+autom[aá]tica|rescisi[oó]n\s+inmediata",
        "rescisión ante las instancias competentes",
        body,
        flags=re.I,
    )
    return body


def _ground_articles(articles: list[str], body: str, contract_type: str) -> tuple[list[str], str]:
    found = [re.sub(r"\D", "", item) for item in articles if re.sub(r"\D", "", item)]
    found += re.findall(r"art(?:iculo|s)?\.?\s*(\d+)", _fold(body))
    unique = []
    for article in found:
        if article and article not in unique:
            unique.append(article)
    folded = _fold(body)
    tenant_sanction = "arrendatario" in folded and any(
        token in folded for token in ("rescis", "incumpl")
    )
    landlord_duty = _mentions_landlord_duty(folded)
    if contract_type == "renta":
        body = re.sub(
            r"art[ií]culos?\s+1564(?:\s*y\s*|\s*,\s*)1574",
            "artículos 1583, fracción III, y 1629, fracción II",
            body,
            flags=re.I,
        )
        if tenant_sanction and not landlord_duty:
            unique = [article for article in unique if article != "1564"]
            if "1574" in unique:
                unique = [article for article in unique if article != "1574"]
            if not any(article in TENANT_CITES for article in unique):
                unique = ["1583", "1629"]
        elif landlord_duty:
            unique = [article for article in unique if article != "1564"]
            if "1574" not in unique:
                unique.append("1574")
            if "arrendatario" in folded and "1583" not in unique:
                unique.append("1583")
        if "1564" in unique and tenant_sanction:
            unique = [article for article in unique if article != "1564"]
    if contract_type == "venta" and not unique:
        unique = ["1397"]
    return unique[:4], _soften_rescission(body)


def _off_topic_catalog(extra_id: str, title: str, message: str) -> bool:
    folded = _fold(message)
    if not folded:
        return False
    look = _fold(f"{extra_id} {title}")
    for item in load_catalog("extras").get("items") or []:
        item_id = str(item.get("id") or "")
        needles = item.get("match") or []
        if item_id and (item_id in look):
            return not any(needle in folded for needle in needles)
    return False


def validate_composed(raw: list, contract_type: str, message: str = "") -> list[dict]:
    cleaned = []
    seen = set()
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        body = re.sub(r"\s+", " ", str(item.get("body") or "").strip())
        if len(title) < 3 or len(title) > 70:
            continue
        if len(body) < 70 or len(body) > 1100:
            continue
        folded = _fold(body + " " + title)
        if _shifts_structure_to_tenant(folded):
            fallback = build_extra("reparaciones", contract_type=contract_type, message=title)
            if fallback and fallback["id"] not in seen:
                seen.add(fallback["id"])
                cleaned.append(fallback)
            continue
        if _is_usury_body(folded):
            fallback = build_extra("mora", contract_type=contract_type, message=title)
            if fallback and fallback["id"] not in seen:
                seen.add(fallback["id"])
                cleaned.append(fallback)
            continue
        if _is_forfeiture_penalty_body(folded):
            fallback = build_extra("uso-licito", contract_type=contract_type, message=title)
            if fallback and fallback["id"] not in seen:
                seen.add(fallback["id"])
                cleaned.append(fallback)
            continue
        if _is_abusive_entry_body(folded) or _is_auto_increase_body(folded):
            continue
        if any(bad in folded for bad in FORBIDDEN):
            continue
        if any(marker in folded for marker in DISCRIM_MARKERS) and any(
            token in folded for token in ("prohib", "no permitir", "sin autoriz")
        ):
            continue
        extra_id = _slug(str(item.get("id") or title))
        if extra_id in RESERVED_IDS or extra_id in seen:
            extra_id = _slug(f"{title}-{len(cleaned)+1}")
        if extra_id in RESERVED_IDS:
            continue
        if _off_topic_catalog(extra_id, title, message):
            continue
        articles, body = _ground_articles(item.get("articles") or [], body, contract_type)
        seen.add(extra_id)
        cleaned.append(
            {
                "id": extra_id,
                "title": title.split(".-")[-1].strip()[:60],
                "articles": articles,
                "body": body,
            }
        )
        if len(cleaned) >= 2:
            break
    return cleaned


def parse_composed(result: dict) -> list:
    for block in result.get("output", {}).get("message", {}).get("content", []):
        tool_use = block.get("toolUse") or {}
        if tool_use.get("name") == "apply_extra_clauses":
            payload = tool_use.get("input") or {}
            return payload.get("clauses") or []
    return []


REWRITE_TOOL = {
    "toolSpec": {
        "name": "apply_rewritten_clauses",
        "description": (
            "Devuelve SOLO las cláusulas que cambian de verdad. "
            "Omite las que quedan igual. Conserva los id."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "required": ["clauses"],
                "properties": {
                    "clauses": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["id", "title", "body"],
                            "properties": {
                                "id": {"type": "string"},
                                "title": {"type": "string"},
                                "articles": {"type": "array", "items": {"type": "string"}},
                                "body": {"type": "string"},
                            },
                        },
                    }
                },
            }
        },
    }
}

REWRITE_SYSTEM = (
    "Este chat edita el borrador. Cambia ÚNICAMENTE lo que el usuario pidió. "
    "No reescribas, no corrijas estilo, puntuación, concordancia ni mayúsculas en el resto. "
    "No inventes partes, montos ni direcciones. No cambies renta por compraventa ni al revés. "
    "Si pide un término en todo el documento (EL PROMITENTE, etc.), ahí sí aplícalo donde aparezca. "
    "Si pide una sola cláusula o un solo dato, deja las demás cláusulas fuera de la respuesta. "
    "Conserva los id. Llama apply_rewritten_clauses."
)


def parse_rewritten(result: dict) -> list:
    for block in result.get("output", {}).get("message", {}).get("content", []):
        tool_use = block.get("toolUse") or {}
        if tool_use.get("name") == "apply_rewritten_clauses":
            payload = tool_use.get("input") or {}
            return payload.get("clauses") or []
    return []


def _clause_norm(clause: dict) -> tuple:
    title = re.sub(r"\s+", " ", (clause.get("title") or "")).replace("\u0001", "").replace("\u0002", "").strip()
    body = re.sub(r"\s+", " ", (clause.get("body") or "")).replace("\u0001", "").replace("\u0002", "").strip()
    return (clause.get("id"), title, body)


def merge_rewritten(original: list, incoming: list) -> list:
    incoming_by_id = {
        item.get("id"): item
        for item in incoming or []
        if item.get("id") and item.get("body")
    }
    used: set[str] = set()
    merged: list[dict] = []
    for previous in original or []:
        clause_id = previous.get("id")
        item = incoming_by_id.get(clause_id) if clause_id else None
        if not item:
            merged.append(previous)
            continue
        used.add(clause_id)
        next_clause = {
            "id": clause_id,
            "title": item.get("title") or previous.get("title"),
            "articles": item.get("articles") or previous.get("articles") or [],
            "body": item.get("body"),
        }
        merged.append(previous if _clause_norm(previous) == _clause_norm(next_clause) else next_clause)
    for item in incoming or []:
        clause_id = item.get("id")
        if not clause_id or clause_id in used or not item.get("body"):
            continue
        merged.append(
            {
                "id": clause_id,
                "title": item.get("title"),
                "articles": item.get("articles") or [],
                "body": item.get("body"),
            }
        )
    return merged or original


def rewrite_user_prompt(message: str, contract_type: str, clauses: list, slots: dict) -> str:
    compact = []
    for clause in clauses:
        compact.append(
            {
                "id": clause.get("id"),
                "title": clause.get("title"),
                "articles": clause.get("articles") or [],
                "body": clause.get("body"),
            }
        )
    return (
        f"Tipo de contrato: {contract_type}\n"
        f"Datos: {json.dumps(slots or {}, ensure_ascii=False)}\n\n"
        f"Cláusulas actuales:\n{json.dumps(compact, ensure_ascii=False)}\n\n"
        f"Instrucción del usuario:\n{message}\n"
    )


def compose_user_prompt(
    message: str,
    contract_type: str,
    existing_extras: list,
    context: str,
) -> str:
    already = ", ".join(item.get("title") or item.get("id") or "" for item in existing_extras) or "ninguna"
    return (
        f"Tipo de contrato: {contract_type}\n"
        f"Cláusulas extra ya presentes: {already}\n\n"
        f"Ejemplos de tono y formato (plantilla oficial):\n{_example_block(contract_type, message)}\n\n"
        f"Contexto legal recuperado:\n{context or 'Código Civil del Estado de Yucatán.'}\n\n"
        f"Pedido del usuario:\n{message}\n"
    )
