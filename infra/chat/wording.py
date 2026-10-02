from __future__ import annotations

import re
import unicodedata


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text or "")
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn").lower()


def split_party_names(raw: str) -> list[str]:
    text = re.sub(r"\s+", " ", raw or "").strip()
    if not text or re.fullmatch(r"_+", text):
        return []
    names: list[str] = []
    for chunk in re.split(r"[,;/]+", text):
        names.extend(_split_on_y(chunk.strip()))
    return [re.sub(r"\s+", " ", name).strip() for name in names if name.strip()]


def _split_on_y(part: str) -> list[str]:
    match = re.match(r"^(.*?)\s+(?:y|e)\s+(.*)$", part, re.I)
    if not match:
        return [part] if part else []
    left, right = match.group(1).strip(), match.group(2).strip()
    if len(left.split()) >= 2 and len(right.split()) >= 2:
        return _split_on_y(left) + _split_on_y(right)
    return [part]


def extract_quoted(message: str) -> list[str]:
    found = re.findall(r"[\"“”«»]([^\"“”«»]{4,80})[\"“”«»]", message or "")
    caps = re.findall(r"\b((?:EL|LOS|LA|LAS)\s+PROMITENTE(?:S)?\s+\w+)\b", message or "", re.I)
    merged: list[str] = []
    for item in [*found, *caps]:
        clean = re.sub(r"\s+", " ", item).strip()
        if clean and clean not in merged:
            merged.append(clean)
    return merged


def clauses_text_equal(left: list, right: list) -> bool:
    def norm(clause: dict) -> tuple:
        title = re.sub(r"\s+", " ", (clause.get("title") or "")).replace("\u0001", "").replace("\u0002", "").strip()
        body = re.sub(r"\s+", " ", (clause.get("body") or "")).replace("\u0001", "").replace("\u0002", "").strip()
        return (clause.get("id"), title, body)

    return [norm(item) for item in left or []] == [norm(item) for item in right or []]


def _replace_ci(text: str, old: str, new: str) -> str:
    if not old or old.lower() == new.lower():
        return text
    return re.sub(re.escape(old), lambda _: new, text, flags=re.I)


def _apply_to_clauses(clauses: list, replacements: list[tuple[str, str]]) -> list[dict]:
    ordered = sorted(replacements, key=lambda pair: len(pair[0]), reverse=True)
    next_clauses: list[dict] = []
    for clause in clauses:
        title = clause.get("title") or ""
        body = clause.get("body") or ""
        for old, new in ordered:
            title = _replace_ci(title, old, new)
            body = _replace_ci(body, old, new)
        next_clauses.append({**clause, "title": title, "body": body})
    return next_clauses


def _vendedor_forms(desired: str, plural: bool) -> list[tuple[str, str]]:
    desired_up = desired.upper()
    olds = [
        "LOS PROMITENTES VENDEDORES",
        "EL PROMITENTE VENDEDOR",
        "LOS VENDEDORES",
        "EL VENDEDOR",
        "los promitentes vendedores",
        "el promitente vendedor",
        "los vendedores",
        "el vendedor",
    ]
    pairs = [(old, desired if old.isupper() else desired.title() if old[:1].isupper() and old[1:2].islower() else desired.lower()) for old in olds]
    # Keep exact desired for uppercase sources; lowercase for lowercase sources
    pairs = []
    desired_low = desired.lower()
    for old in olds:
        if old.isupper():
            pairs.append((old, desired_up))
        else:
            pairs.append((old, desired_low))
    if plural:
        pairs.extend(
            [
                ("Declaraciones del vendedor", "Declaraciones de los promitentes vendedores"),
                ("del vendedor", "de los promitentes vendedores"),
                ("DEL VENDEDOR", "DE LOS PROMITENTES VENDEDORES"),
                ("El vendedor declara", "Los promitentes vendedores declaran"),
                ("El vendedor vende", "Los promitentes vendedores venden"),
                ("El vendedor responderá", "Los promitentes vendedores responderán"),
                ("El vendedor se obliga", "Los promitentes vendedores se obligan"),
            ]
        )
    return pairs


def desired_seller_label(message: str, slots: dict) -> str | None:
    quotes = extract_quoted(message)
    folded = _fold(message)
    sellers = split_party_names((slots or {}).get("vendedor") or "")
    plural = len(sellers) > 1 or ("plural" in folded and "singular" not in folded)
    singular_q = next((item for item in quotes if re.search(r"\bpromitente vendedor\b", _fold(item)) and "vendedores" not in _fold(item)), None)
    plural_q = next((item for item in quotes if "promitentes vendedores" in _fold(item)), None)
    if not singular_q and re.search(r"el promitente vendedor", folded):
        singular_q = "EL PROMITENTE VENDEDOR"
    if not plural_q and re.search(r"los promitentes vendedores", folded):
        plural_q = "LOS PROMITENTES VENDEDORES"
    if not singular_q and not plural_q:
        return None
    if re.search(r"pluraliz", folded) and plural_q:
        return plural_q.upper()
    if plural:
        return (plural_q or "LOS PROMITENTES VENDEDORES").upper()
    return (singular_q or "EL PROMITENTE VENDEDOR").upper()


def apply_lexical_wording(message: str, clauses: list, slots: dict) -> list[dict] | None:
    if not clauses:
        return None
    desired = desired_seller_label(message, slots)
    replacements: list[tuple[str, str]] = []
    if desired:
        sellers = split_party_names((slots or {}).get("vendedor") or "")
        replacements.extend(_vendedor_forms(desired, len(sellers) > 1 or "VENDEDORES" in desired))
    # Generic "cambia X por Y" / "usa Y en vez de X"
    swap = re.search(
        r"(?:cambia|reemplaza|sustituye)\s+[\"“]?([^\"”]{3,60})[\"”]?\s+por\s+[\"“]?([^\"”]{3,60})[\"”]?",
        message or "",
        re.I,
    )
    if swap:
        replacements.append((swap.group(1).strip(), swap.group(2).strip()))
    if not replacements:
        return None
    next_clauses = _apply_to_clauses(clauses, replacements)
    if clauses_text_equal(clauses, next_clauses):
        return None
    return next_clauses


def instruction_satisfied(message: str, clauses: list, slots: dict) -> bool:
    desired = desired_seller_label(message, slots)
    blob = " ".join(f"{item.get('title') or ''} {item.get('body') or ''}" for item in clauses)
    folded = _fold(blob)
    swap = re.search(
        r"(?:cambia|reemplaza|sustituye)\s+[\"“]?([^\"”]{3,60})[\"”]?\s+por\s+[\"“]?([^\"”]{3,60})[\"”]?",
        message or "",
        re.I,
    )
    if swap and _fold(swap.group(2).strip()) not in folded:
        return False
    if desired:
        return _fold(desired) in folded
    quotes = extract_quoted(message)
    if not quotes:
        return True
    return any(_fold(item) in folded for item in quotes)


def apply_lexical_footer(message: str, footer: dict | None, slots: dict) -> dict:
    next_footer = dict(footer or {})
    desired = desired_seller_label(message, slots)
    if desired:
        next_footer["leftLabel"] = desired
    return next_footer


def keep_unmodified(original: list, rewritten: list) -> list[dict]:
    by_id = {item.get("id"): item for item in original or [] if item.get("id")}
    kept: list[dict] = []
    for item in rewritten or []:
        previous = by_id.get(item.get("id"))
        kept.append(previous if previous and clauses_text_equal([previous], [item]) else item)
    return kept


def join_party_names(names: list[str]) -> str:
    clean = [name.strip() for name in names if name.strip()]
    if not clean:
        return ""
    if len(clean) == 1:
        return clean[0]
    if len(clean) == 2:
        return f"{clean[0]} y {clean[1]}"
    return f"{', '.join(clean[:-1])} y {clean[-1]}"


def _ensure_signers(footer: dict, slots: dict, contract_type: str | None) -> dict:
    next_footer = dict(footer or {})
    renta = contract_type == "renta"
    if not isinstance(next_footer.get("leftSigners"), list):
        key = "arrendador" if renta else "vendedor"
        next_footer["leftSigners"] = split_party_names(
            (slots or {}).get(key) or next_footer.get("leftName") or ""
        )
    if not isinstance(next_footer.get("rightSigners"), list):
        key = "arrendatario" if renta else "comprador"
        next_footer["rightSigners"] = split_party_names(
            (slots or {}).get(key) or next_footer.get("rightName") or ""
        )
    return next_footer


_ADD_AS_RE = re.compile(
    r"(?:agrega|a[nñ]ade|incluye|suma)\s+(?:a\s+)?[\"“«]?([^\"”»]{3,80}?)[\"”»]?\s+como\s+"
    r"(vendedora?s?|compradoras?|arrendadoras?|arrendatarias?|promitentes?)",
    re.I,
)
_ADD_FIRMA_RE = re.compile(
    r"(?:agrega|a[nñ]ade|incluye|suma)\s+(?:una\s+)?(?:nueva\s+)?(?:firma|firmante|l[ií]nea(?:\s+de\s+firma)?)"
    r"\s+(?:de\s+|para\s+)?[\"“«]?([^\"”»,.]{3,80})[\"”»]?",
    re.I,
)


def is_footer_instruction(message: str) -> bool:
    folded = _fold(message)
    if _ADD_AS_RE.search(message or "") or _ADD_FIRMA_RE.search(message or ""):
        return True
    if re.search(r"may[uú]sculas", folded) and re.search(
        r"firma|firmante|nombre", folded
    ):
        return True
    return False


def _role_side(role: str, contract_type: str | None) -> str:
    folded = _fold(role)
    if any(word in folded for word in ("comprador", "arrendatari")):
        return "right"
    return "left"


def apply_footer_instruction(
    message: str,
    footer: dict | None,
    slots: dict,
    contract_type: str | None,
) -> tuple[dict | None, str | None]:
    if not is_footer_instruction(message):
        return None, None
    next_footer = _ensure_signers(footer, slots, contract_type)
    folded = _fold(message)
    left = list(next_footer.get("leftSigners") or [])
    right = list(next_footer.get("rightSigners") or [])

    add = _ADD_AS_RE.search(message or "") or _ADD_FIRMA_RE.search(message or "")
    if add:
        name = re.sub(r"\s+", " ", add.group(1)).strip(" .,;:")
        side = "left"
        if add.re is _ADD_AS_RE:
            side = _role_side(add.group(2), contract_type)
        elif any(word in folded for word in ("comprador", "arrendatari")):
            side = "right"
        names = right if side == "right" else left
        if not any(_fold(item) == _fold(name) for item in names):
            names.append(name)
        if side == "right":
            next_footer["rightSigners"] = names
            next_footer["rightName"] = join_party_names(names)
            next_footer["rightHidden"] = False
        else:
            next_footer["leftSigners"] = names
            next_footer["leftName"] = join_party_names(names)
            next_footer["leftHidden"] = False
        return next_footer, f"Agregué la firma de {name}."

    if re.search(r"may[uú]sculas", folded):
        quotes = extract_quoted(message)
        targets = [_fold(item) for item in quotes]

        def bump(names: list[str]) -> list[str]:
            if not targets or re.search(r"\b(todos|todas|nombres|firmas|firmantes)\b", folded):
                return [item.upper() for item in names]
            return [
                item.upper() if any(target in _fold(item) for target in targets) else item
                for item in names
            ]

        next_footer["leftSigners"] = bump(left)
        next_footer["rightSigners"] = bump(right)
        next_footer["leftName"] = join_party_names(next_footer["leftSigners"])
        next_footer["rightName"] = join_party_names(next_footer["rightSigners"])
        return next_footer, "Pasé a mayúsculas los nombres de las firmas."

    return None, None
