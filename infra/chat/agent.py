from __future__ import annotations

import re

from clauses import (
    build_clauses,
    extra_from_extracted,
    extras_from_message,
    is_edit_instruction,
    merge_extras,
)
from compose import (
    is_abusive_entry_request,
    is_auto_increase_request,
    is_discriminatory_request,
    is_forfeiture_request,
    is_repair_shift_request,
    is_self_help_request,
    is_usury_request,
)

RENTA_REQUIRED = [
    ("arrendador", "Nombre del arrendador (quien renta la casa)."),
    ("arrendatario", "Nombre del arrendatario (quien vive)."),
    ("direccion", "Dirección completa del inmueble en Yucatán."),
    ("rentaMensual", "Renta mensual en pesos."),
    ("plazo", "Plazo del contrato (por ejemplo 12 meses)."),
    ("deposito", "Depósito (1 mes o 2 meses de renta)."),
]

VENTA_REQUIRED = [
    ("vendedor", "Nombre del vendedor."),
    ("comprador", "Nombre del comprador."),
    ("direccion", "Dirección completa del inmueble en Yucatán."),
    ("precio", "Precio de la operación en pesos."),
    ("formaPago", "Forma de pago (contado, enganche, etc.)."),
]


def empty_state(conv_id: str) -> dict:
    return {
        "convId": conv_id,
        "contractType": None,
        "title": "Nueva conversación",
        "slots": {},
        "pendingQuestions": [],
        "pendingEvictionProposal": False,
        "currentVersion": 0,
        "extraClauses": [],
    }


def required_fields(contract_type: str | None) -> list[tuple[str, str]]:
    if contract_type == "renta":
        return RENTA_REQUIRED
    if contract_type == "venta":
        return VENTA_REQUIRED
    return []


def missing_fields(contract_type: str | None, slots: dict) -> list[dict]:
    missing = []
    for key, prompt in required_fields(contract_type):
        if not str(slots.get(key) or "").strip():
            missing.append({"id": key, "prompt": prompt})
    return missing


def clean_value(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"null", "none", "n/a", "desconocido", "no sé", "no se"}:
        return None
    return text


def normalize_type(value) -> str | None:
    text = (clean_value(value) or "").lower()
    if text in {"renta", "arrendamiento", "alquiler"}:
        return "renta"
    if text in {"venta", "compraventa"}:
        return "venta"
    return None


def merge_extracted(state: dict, extracted: dict) -> dict:
    next_state = {
        **empty_state(state.get("convId") or "conv_unknown"),
        **state,
        "slots": dict(state.get("slots") or {}),
        "pendingQuestions": [],
        "pendingEvictionProposal": False,
        "extraClauses": list(state.get("extraClauses") or []),
    }
    detected = normalize_type(extracted.get("contractType")) or next_state.get("contractType")
    if detected:
        next_state["contractType"] = detected

    keys = [
        "arrendador",
        "arrendatario",
        "vendedor",
        "comprador",
        "direccion",
        "rentaMensual",
        "plazo",
        "deposito",
        "diaPago",
        "precio",
        "formaPago",
    ]
    for key in keys:
        value = clean_value(extracted.get(key))
        if value:
            next_state["slots"][key] = value
    return next_state


_DEPOSIT_WORDS = {
    "un": 1,
    "una": 1,
    "dos": 2,
    "tres": 3,
    "cuatro": 4,
    "cinco": 5,
    "seis": 6,
}


def deposit_from_message(message: str) -> str | None:
    text = (message or "").lower()
    if "depósito" not in text and "deposito" not in text:
        return None
    # Buscamos "N meses" solo en la frase que menciona el depósito, no en todo el
    # mensaje: si no, un plazo como "12 meses" en otra frase se confundía con el
    # depósito (ej. "...Plazo: 12 meses. Depósito: 1 mes de renta." tomaba 12).
    for sentence in re.split(r"[.;\n]", text):
        if "depósito" not in sentence and "deposito" not in sentence:
            continue
        match = re.search(r"(un|una|dos|tres|cuatro|cinco|seis|\d+)\s*mes(?:es)?\b", sentence, re.I)
        if not match:
            continue
        token = match.group(1).lower()
        count = _DEPOSIT_WORDS.get(token) or int(token)
        if count < 1:
            continue
        return "1 mes de renta" if count == 1 else f"{count} meses de renta"
    return None


def title_from(contract_type: str | None, address: str | None) -> str:
    short = ""
    if address:
        short = address.split(",")[0].strip()
        if len(short) > 28:
            short = short[:26] + "…"
    if contract_type == "renta" and short:
        return f"Renta · {short}"
    if contract_type == "venta" and short:
        return f"Venta · {short}"
    if contract_type == "renta":
        return "Contrato de renta"
    if contract_type == "venta":
        return "Contrato de compraventa"
    return "Nueva conversación"


def fallback_citations(contract_type: str) -> list[dict]:
    if contract_type == "renta":
        return [
            {"source": "codigo_civil_yucatan.pdf", "article": "1564-1650"},
            {"source": "codigo_civil_yucatan.pdf", "article": "1619"},
            {"source": "renta.json"},
        ]
    return [
        {"source": "codigo_civil_yucatan.pdf", "article": "1397-1473"},
        {"source": "NOM-247-SE-2021"},
        {"source": "venta.json"},
    ]


def generate_document(state: dict) -> tuple[dict, list[dict]]:
    contract_type = state["contractType"]
    slots = dict(state.get("slots") or {})
    if contract_type == "renta" and not slots.get("diaPago"):
        slots["diaPago"] = "día 5 de cada mes"
    clauses = build_clauses(contract_type, slots, state.get("extraClauses") or [])
    version = int(state.get("currentVersion") or 0) + 1
    doc_id = state.get("documentId") or f"doc_{state['convId']}"
    title = title_from(contract_type, slots.get("direccion"))
    state["slots"] = slots
    state["documentId"] = doc_id
    state["currentVersion"] = version
    state["title"] = title
    return {"id": doc_id, "version": version, "title": title}, clauses


def stamp_rewritten(state: dict, clauses: list[dict]) -> tuple[dict, list[dict]]:
    version = int(state.get("currentVersion") or 0) + 1
    doc_id = state.get("documentId") or f"doc_{state['convId']}"
    title = state.get("title") or title_from(state.get("contractType"), (state.get("slots") or {}).get("direccion"))
    state["documentId"] = doc_id
    state["currentVersion"] = version
    state["title"] = title
    return {"id": doc_id, "version": version, "title": title}, clauses


def decide_turn(state: dict, extracted: dict, message: str = "") -> dict:
    previous_slots = dict(state.get("slots") or {})
    previous_extras = list(state.get("extraClauses") or [])
    state = merge_extracted(state, extracted)
    deposit = deposit_from_message(message)
    if deposit:
        state["slots"]["deposito"] = deposit
    contract_type = state.get("contractType")
    incoming_extras = extra_from_extracted(extracted, contract_type, message)
    incoming_extras = merge_extras(incoming_extras, extras_from_message(message, contract_type))
    if incoming_extras:
        state["extraClauses"] = merge_extras(state.get("extraClauses"), incoming_extras)
    extras_changed = state.get("extraClauses") != previous_extras
    slots_changed = state.get("slots") != previous_slots
    has_draft = int(state.get("currentVersion") or 0) > 0 and bool(state.get("contractType"))
    wants_revision = extras_changed or slots_changed or (
        has_draft and is_edit_instruction(message, extracted)
    )

    if has_draft and wants_revision and not missing_fields(state.get("contractType"), state["slots"]):
        if not extras_changed and (
            is_self_help_request(message)
            or is_usury_request(message)
            or is_forfeiture_request(message)
            or is_abusive_entry_request(message)
            or is_auto_increase_request(message)
        ):
            if is_self_help_request(message) or is_usury_request(message):
                text = (
                    "No redacté usura, cambio de candados ni desalojo por vía de hecho. "
                    "La mora se rige por lo que permita la ley y la rescisión por tres meses sin pago "
                    "(art. 1629, fracción I)."
                )
            elif is_forfeiture_request(message):
                text = (
                    "No redacté el pago del valor de la casa ni cité 1583 como extinción de dominio. "
                    "El blindaje real es el contrato por escrito y, si acaso, su ratificación."
                )
            elif is_abusive_entry_request(message):
                text = (
                    "No puse entrada sin aviso ni de noche. La inspección ya está en conservación: "
                    "día y hora hábiles, aviso de 24 horas, sin estorbar el uso (art. 1574)."
                )
            else:
                text = (
                    "No puse un aumento automático de renta. La cláusula de pago ya impide revisiones "
                    "en periodos menores a los que permita la ley."
                )
            return {
                "text": text,
                "questions": [],
                "document": None,
                "clauses": [],
                "nextState": state,
                "fallbackCitations": fallback_citations(state["contractType"]),
            }
        return {
            "text": "Voy a aplicar ese cambio en el borrador.",
            "questions": [],
            "document": None,
            "clauses": [],
            "needsRewrite": True,
            "nextState": state,
            "fallbackCitations": fallback_citations(state["contractType"]),
        }

    if has_draft and not wants_revision and not missing_fields(state.get("contractType"), state["slots"]):
        return {
            "text": "Cuando quieras cambiar el borrador, escríbelo y lo aplico aquí mismo.",
            "questions": [],
            "document": None,
            "clauses": [],
            "nextState": state,
            "fallbackCitations": fallback_citations(state["contractType"]),
        }

    if not state.get("contractType"):
        questions = [
            {"id": "tipo-renta", "prompt": "Renta (arrendamiento de vivienda)."},
            {"id": "tipo-venta", "prompt": "Compraventa de vivienda."},
        ]
        state["pendingQuestions"] = questions
        return {
            "text": "Puedo armar un contrato de renta o de compraventa de vivienda en Yucatán. ¿Cuál necesitas?",
            "questions": questions,
            "document": None,
            "clauses": [],
            "nextState": state,
            "fallbackCitations": [],
        }

    missing = missing_fields(state["contractType"], state["slots"])
    if missing:
        kind = "renta" if state["contractType"] == "renta" else "compraventa"
        state["title"] = title_from(state["contractType"], state["slots"].get("direccion"))
        state["pendingQuestions"] = missing
        listed = "\n".join(f"• {item['prompt']}" for item in missing)
        return {
            "text": (
                f"Va, {kind}. Me faltan estos datos para armar el contrato con las cláusulas del "
                f"Código Civil de Yucatán:\n{listed}"
            ),
            "questions": missing,
            "document": None,
            "clauses": [],
            "nextState": state,
            "fallbackCitations": fallback_citations(state["contractType"]),
        }

    document, clauses = generate_document(state)
    kind = "renta" if state["contractType"] == "renta" else "compraventa"
    extra = (
        " La transmisión se formaliza en escritura pública e inscripción ante INSEJUPY."
        if state["contractType"] == "venta"
        else " El depósito no se aplica a rentas (art. 1619)."
    )
    return {
        "text": (
            f"Listo: aquí está el borrador de {kind}, versión {document['version']}, "
            f"con las cláusulas de la plantilla. Ábrelo para revisar o descargar Word/PDF."
            f"{extra}"
        ),
        "questions": [],
        "document": document,
        "clauses": clauses,
        "nextState": state,
        "fallbackCitations": fallback_citations(state["contractType"]),
    }


EXTRACT_TOOL = {
    "toolSpec": {
        "name": "apply_extracted_data",
        "description": (
            "Registra los datos del contrato que el usuario ya dio. "
            "Deja vacío lo que no haya dicho. No inventes nombres, montos ni direcciones."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "contractType": {
                        "type": "string",
                        "enum": ["renta", "venta", ""],
                        "description": "renta o venta. Vacío si no se sabe.",
                    },
                    "arrendador": {"type": "string"},
                    "arrendatario": {"type": "string"},
                    "vendedor": {"type": "string"},
                    "comprador": {"type": "string"},
                    "direccion": {"type": "string"},
                    "rentaMensual": {"type": "string"},
                    "plazo": {"type": "string"},
                    "deposito": {"type": "string"},
                    "diaPago": {"type": "string"},
                    "precio": {"type": "string"},
                    "formaPago": {"type": "string"},
                    "wantsRevision": {
                        "type": "boolean",
                        "description": (
                            "true si el mensaje debe editar el borrador. "
                            "En un documento ya creado, true salvo saludo, gracias o una pregunta legal que no pida cambiar el texto."
                        ),
                    },
                    "needsCustomExtra": {
                        "type": "boolean",
                        "description": "true si pide un pacto extra que no es mascotas ni estacionamiento.",
                    },
                    "extraClauseRequest": {
                        "type": "string",
                        "description": "Idea de la cláusula extra, aunque no esté en el catálogo.",
                    },
                    "extraClause": {
                        "type": "object",
                        "description": "Cláusula extra estructurada. No inventes prohibición si el usuario permite.",
                        "properties": {
                            "id": {
                                "type": "string",
                                "enum": ["mascotas", "estacionamiento", ""],
                            },
                            "mode": {
                                "type": "string",
                                "enum": ["prohibido", "permitido", ""],
                            },
                            "max": {"type": "number"},
                            "detalle": {"type": "string"},
                        },
                    },
                },
            }
        },
    }
}

EXTRACT_SYSTEM = (
    "Extrae SOLO hechos que el usuario escribió. No completes con ejemplos. "
    "Si dice arrendamiento, renta o alquiler → contractType=renta. "
    "Si dice compraventa o vender casa → contractType=venta. "
    "Si ya hay un borrador, casi siempre wantsRevision=true: correcciones de redacción, "
    "singular/plural, nombres, montos, quitar o agregar texto. "
    "Solo wantsRevision=false si es un saludo, gracias, o una pregunta legal que no pide tocar el documento. "
    "Si pide cambiar datos, agregar o quitar una cláusula, o dice olvide/añade → wantsRevision=true. "
    "Si cambia el depósito a N meses → deposito='N meses de renta' y wantsRevision=true. No lo trates como pacto extra. "
    "Si pide no/sin/prohibido mascotas → extraClause id=mascotas mode=prohibido. "
    "Si pide permitir mascotas o máximo N mascotas → extraClause id=mascotas mode=permitido, max y detalle. "
    "Solo usa extraClause.id=mascotas si el usuario mencionó mascotas. "
    "No pongas prohibido si el usuario permite mascotas. "
    "Si pide estacionamiento o cochera → extraClause id=estacionamiento. "
    "Si pide cualquier otro pacto (ocupación, fiestas, visitas, ruido, fumar, reparaciones) → needsCustomExtra=true "
    "y extraClauseRequest con esa idea. No inventes un id de catálogo. "
    "Si pide cerrajero, candados, corte de servicios, usura o el valor de la casa por drogas, "
    "marca wantsRevision=true y extraClauseRequest vacío. "
    "Dirección puede ser calle, avenida, colonia, código postal, Mérida, Yucatán. "
    "Llama la herramienta apply_extracted_data. No respondas en texto libre."
)
