from __future__ import annotations

import json
import os
import re
import time
import unicodedata
from pathlib import Path

ORDINALS = [
    "PRIMERA",
    "SEGUNDA",
    "TERCERA",
    "CUARTA",
    "QUINTA",
    "SEXTA",
    "SÉPTIMA",
    "OCTAVA",
    "NOVENA",
    "DÉCIMA",
    "UNDÉCIMA",
    "DUODÉCIMA",
    "DECIMOTERCERA",
    "DECIMOCUARTA",
]

EMPH_OPEN = "\u0001"
EMPH_CLOSE = "\u0002"
WORD_NUM = {"una": 1, "un": 1, "uno": 1, "dos": 2, "tres": 3}

_TEMPLATE_CACHE: dict[str, tuple[float, dict]] = {}


def official_value(value: str) -> str:
    text = (value or "").strip()
    if not text or text == "[por definir]":
        return text or "[por definir]"
    return f"{EMPH_OPEN}{text.upper()}{EMPH_CLOSE}"


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn").lower()


def _local_path(name: str) -> Path:
    # infra/chat/templates/ es la única fuente de verdad para las plantillas de contrato.
    # El frontend ya no mantiene una copia propia: siempre recibe las cláusulas ya
    # redactadas desde el backend.
    path = Path(__file__).resolve().parent / "templates" / f"{name}.json"
    if path.exists():
        return path
    raise FileNotFoundError(f"No está la plantilla {name}.json")


def load_catalog(name: str) -> dict:
    bucket = os.environ.get("TEMPLATES_BUCKET") or ""
    prefix = os.environ.get("TEMPLATES_PREFIX") or "templates/"
    now = time.time()
    cached = _TEMPLATE_CACHE.get(name)
    if cached and now - cached[0] < 60:
        return cached[1]
    payload = None
    if bucket:
        try:
            import boto3

            key = f"{prefix}{name}.json"
            body = boto3.client("s3").get_object(Bucket=bucket, Key=key)["Body"].read()
            payload = json.loads(body.decode("utf-8"))
        except Exception as error:
            print("template_s3_miss", name, error)
    if payload is None:
        payload = json.loads(_local_path(name).read_text(encoding="utf-8"))
    _TEMPLATE_CACHE[name] = (now, payload)
    return payload


def fill_text(text: str, slots: dict, blank: str = "[por definir]") -> str:
    def repl(match: re.Match[str]) -> str:
        raw = slots.get(match.group(1))
        if raw is None or raw == "":
            return blank
        value = str(raw)
        prefix = " " if value.startswith(" ") else ""
        return prefix + official_value(value)

    return re.sub(r"\{\{(\w+)\}\}", repl, text)


def _contains_any(text: str, needles: list | None) -> bool:
    return any(needle in text for needle in needles or [])


def _max_pets(text: str) -> int:
    match = re.search(r"(?:maximo|hasta)\s+(?:de\s+)?(\d+|una|un|uno|dos|tres)", text, re.I)
    if match:
        token = match.group(1).lower()
        return WORD_NUM.get(token) or int(token)
    if re.search(r"\buna mascota\b", text):
        return 1
    return 1


_PET_BAN_RE = re.compile(
    r"no se permit|no permit|sin mascot|prohibid|ningun(a|o)?(\s+tipo)?|cero mascot|"
    r"0 mascot|no mascot|tampoco.*mascot|mascotas de ningun",
    re.I,
)


def _pick_mode(item: dict, text: str, extracted_mode: str | None = None) -> str:
    variants = item.get("variants") or {}
    modes = item.get("modes") or {}
    default = item.get("defaultMode") or next(iter(variants), "default")
    # "no se permiten mascotas" contiene "permite"; eso no es un permiso.
    if item.get("id") == "mascotas" and _PET_BAN_RE.search(text):
        return "prohibido" if "prohibido" in variants else default
    if extracted_mode and extracted_mode in variants:
        if item.get("id") == "mascotas" and extracted_mode == "permitido" and _PET_BAN_RE.search(text):
            return "prohibido"
        return extracted_mode
    for mode, needles in modes.items():
        if mode != default and _contains_any(text, needles):
            if not _contains_any(text, modes.get(default) or []):
                return mode
    return default


def _extra_slots(item: dict, text: str, extracted: dict | None = None) -> dict:
    catalog = load_catalog("extras")
    words = catalog.get("numberWords") or {}
    extracted = extracted or {}
    try:
        count = int(extracted["max"]) if extracted.get("max") else _max_pets(text)
    except (TypeError, ValueError):
        count = _max_pets(text)
    if count < 1:
        count = 1
    detalle = extracted.get("detalle") or ""
    if not detalle:
        for key, value in (item.get("detalleMap") or {}).items():
            if key in text:
                detalle = value
                break
    if detalle and not str(detalle).startswith(" "):
        detalle = f" {detalle}"
    spelled = words.get(str(count), str(count))
    plural = "" if count == 1 else "s"
    return {
        "maxMascotas": spelled,
        "pluralMascotas": plural,
        "detalleMascotas": detalle,
        "maxCantidad": spelled,
        "plural": plural,
        "detalle": detalle,
    }


def build_extra(
    extra_id: str,
    *,
    mode: str | None = None,
    max_pets: int | None = None,
    detalle: str | None = None,
    contract_type: str | None = None,
    message: str = "",
) -> dict | None:
    catalog = load_catalog("extras")
    item = next((entry for entry in catalog.get("items") or [] if entry.get("id") == extra_id), None)
    if not item:
        return None
    text = _fold(message or detalle or "")
    chosen = _pick_mode(item, text, mode)
    kind = "venta" if contract_type == "venta" else "renta"
    body = ((item.get("variants") or {}).get(chosen) or {}).get(kind)
    if not body:
        return None
    slots = _extra_slots(item, text, {"max": max_pets, "detalle": detalle})
    return {
        "id": item["id"],
        "title": item.get("title") or extra_id,
        "articles": item.get("articles") or [],
        "body": fill_text(body, slots, ""),
    }


def extras_from_message(message: str, contract_type: str | None = None) -> list[dict]:
    text = _fold(message)
    found = []
    for item in load_catalog("extras").get("items") or []:
        if not _contains_any(text, item.get("match")):
            continue
        extra = build_extra(item["id"], contract_type=contract_type, message=message)
        if extra:
            found.append(extra)
    return found


def extra_from_extracted(extracted: dict | None, contract_type: str | None = None, message: str = "") -> list[dict]:
    if not extracted:
        return []
    found: list[dict] = []
    extra = extracted.get("extraClause")
    if isinstance(extra, dict) and extra.get("id"):
        extra_id = str(extra.get("id"))
        folded_msg = _fold(message)
        if extra_id == "mascotas" and "mascota" not in folded_msg:
            extra = None
        elif extra_id == "estacionamiento" and "estacionamiento" not in folded_msg and "cochera" not in folded_msg:
            extra = None
    if isinstance(extra, dict) and extra.get("id"):
        built = build_extra(
            extra.get("id"),
            mode=extra.get("mode"),
            max_pets=extra.get("max"),
            detalle=extra.get("detalle"),
            contract_type=contract_type,
            message=message,
        )
        if built:
            found.append(built)
    request = extracted.get("extraClauseRequest")
    if isinstance(request, str) and request.strip():
        found = merge_extras(found, extras_from_message(f"{message} {request}", contract_type))
    composed = extracted.get("composedExtras")
    if isinstance(composed, list):
        found = merge_extras(
            found,
            [item for item in composed if isinstance(item, dict) and item.get("body")],
        )
    return found


_NON_EDIT_RE = re.compile(
    r"^\s*("
    r"gracias(\s+\w+){0,6}|"
    r"(muy\s+)?bien|"
    r"ok(ay)?|"
    r"va|"
    r"perfecto|"
    r"listo|"
    r"hola|"
    r"buenos?\s+d[ií]as|"
    r"buenas(\s+tardes)?|"
    r"(me\s+)?(puedes\s+)?(descargar|bajar|exportar)\s+(el\s+)?(pdf|word)|"
    r"m[aá]ndame\s+el\s+(pdf|word)"
    r")\s*[.!]?\s*$",
    re.I,
)

_LEGAL_QUESTION_RE = re.compile(
    r"^\s*(qu[eé]\s+(es|significa|dice|permite)|expl[ií]came|seg[uú]n\s+el\s+c[oó]digo)\b",
    re.I,
)


def is_non_edit_message(message: str) -> bool:
    """Saludo, gracias o pregunta legal que no pide tocar el borrador."""
    text = re.sub(r"\s+", " ", message or "").strip()
    if len(text) <= 2:
        return True
    if _NON_EDIT_RE.match(text):
        return True
    if _LEGAL_QUESTION_RE.match(text) and not wants_revision_text(text):
        return True
    return False


def wants_revision_text(message: str) -> bool:
    return bool(
        re.search(
            r"\b(agrega|agregue|añade|anade|olvide|olvidé|clausula|cláusula|cambia|modifica|"
            r"actualiza|ajusta|deposito|depósito|mascota|quita|elimina|permite|permitir|"
            r"reparacion|reparación|filtracion|cerrajero|mora|candado|droga|corrige|correg|"
            r"asegur|dejamelo|d[eé]jalo|usa|llame|llamar|refier|redacci[oó]n|en el (contrato|documento|borrador)|"
            r"promitente|plural|singular)\b",
            message,
            re.I,
        )
    )


def is_edit_instruction(message: str, extracted: dict | None = None) -> bool:
    """En el chat del documento casi todo es una edición, salvo excepciones obvias."""
    if extracted and extracted.get("wantsRevision") is True:
        return True
    if is_non_edit_message(message):
        return False
    return True


def merge_extras(current: list | None, incoming: list[dict]) -> list[dict]:
    next_extras = [dict(item) for item in current or []]
    for extra in incoming:
        index = next((i for i, item in enumerate(next_extras) if item.get("id") == extra.get("id")), -1)
        if index >= 0:
            next_extras[index] = dict(extra)
        else:
            next_extras.append(dict(extra))
    return next_extras


def attach_extras(clauses: list[dict], extras: list[dict]) -> list[dict]:
    if not extras:
        return clauses
    core = [clause for clause in clauses if clause.get("id") != "jurisdiccion"]
    jurisdiction = next((clause for clause in clauses if clause.get("id") == "jurisdiccion"), None)
    numbered = [
        clause
        for clause in core
        if re.search(
            r"primera|segunda|tercera|cuarta|quinta|sexta|séptima|septima|octava|novena|décima|decima|undécima|undecima|duodécima|duodecima",
            clause.get("title") or "",
            re.I,
        )
    ]
    start = len(numbered) + 1
    attached = []
    for index, extra in enumerate(extras):
        ordinal = ORDINALS[start + index - 1] if start + index - 1 < len(ORDINALS) else f"Cláusula {start + index}"
        title = extra.get("title") or "Pacto adicional"
        if not re.match(
            r"^(PRIMERA|SEGUNDA|TERCERA|CUARTA|QUINTA|SEXTA|SÉPTIMA|OCTAVA|NOVENA|DÉCIMA|Primera|Segunda|Tercera|Cuarta|Quinta|Sexta|Séptima|Octava|Novena|Décima)\b",
            title,
            re.I,
        ):
            title = f"{ordinal}.- {title}"
        attached.append({**extra, "title": title})
    result = core + attached
    if jurisdiction:
        ordinal = ORDINALS[start + len(extras) - 1] if start + len(extras) - 1 < len(ORDINALS) else "Última"
        result.append({**jurisdiction, "title": f"{ordinal}.- Jurisdicción"})
    return result


def attach_new_extras(clauses: list[dict], extras: list[dict] | None) -> list[dict]:
    have = {clause.get("id") for clause in clauses}
    missing = [extra for extra in extras or [] if extra.get("id") and extra.get("id") not in have]
    return attach_extras(clauses, missing) if missing else clauses


def modules_from_template(contract_type: str, slots: dict) -> list[dict]:
    payload = load_catalog(contract_type)
    filled_slots = dict(slots)
    if contract_type == "renta" and not filled_slots.get("diaPago"):
        filled_slots["diaPago"] = "día 5 de cada mes"
    return [
        {
            "id": module["id"],
            "title": module["title"],
            "articles": module.get("articles") or [],
            "body": fill_text(module.get("body") or "", filled_slots),
        }
        for module in payload.get("modules") or []
    ]


def build_clauses(contract_type: str, slots: dict, extras: list | None = None) -> list[dict]:
    return attach_extras(modules_from_template(contract_type, slots), extras or [])
