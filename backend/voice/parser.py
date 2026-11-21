"""Rule-based understanding of shopkeeper speech (Hindi / Kannada / English / mixed, Latin letters).

Pure functions: no database, no network. The caller passes the shop's customers and products.
The parser never invents amounts: quantities and rupee amounts are only ever read from the words,
and totals are computed later, in code, from database prices.
"""
import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Optional

_CONFIG = json.loads((Path(__file__).with_name("units.json")).read_text(encoding="utf-8"))
NUMBER_WORDS: dict[str, int] = _CONFIG["number_words"]
MULTIPLIERS: dict[str, int] = _CONFIG["amount_multipliers"]
FRACTIONS: dict[str, float] = _CONFIG["fractions"]
UNITS: dict[str, str] = _CONFIG["units"]
SEER_IN_KG = Decimal(str(_CONFIG["seer_in_kg"]))
BRAND_ALIASES: dict[str, str] = _CONFIG["brand_aliases"]

# Endings glued to names in speech: "Ravi-ge", "Ramesh-ka", "Suresh-ne", "Ramesh avarige" ...
NAME_SUFFIXES = ("avarige", "avara", "ige", "ge", "ka", "ki", "ke", "ko", "ne", "gu", "ji", "anna", "avru")

INTENTS = (
    "CREATE_BILL", "ADD_ITEM", "CORRECT_CUSTOMER", "RECORD_PAYMENT", "SHOW_BALANCE", "EXPLAIN_BALANCE",
    "SHOW_HISTORY", "SEND_REMINDER", "ADD_PRODUCT", "UNDO", "UNKNOWN",
)


@dataclass
class CustomerRec:
    id: str
    name: str
    aliases: list[str] = field(default_factory=list)
    locality: Optional[str] = None
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    balance_paise: int = 0
    last_item: Optional[str] = None
    last_sale_at: Optional[datetime] = None


@dataclass
class ProductRec:
    id: str
    name: str
    aliases: list[str] = field(default_factory=list)
    unit: str = "pcs"
    price_paise: Optional[int] = None
    stock: Decimal = Decimal("0")


@dataclass
class ParsedItem:
    product: ProductRec
    qty: Decimal
    note: Optional[str] = None


@dataclass
class Parsed:
    intent: str
    transcript: str
    names: list[str] = field(default_factory=list)  # customer names heard, in order (lower case)
    items: list[ParsedItem] = field(default_factory=list)
    amount_paise: Optional[int] = None
    mode: Optional[str] = None  # cash | upi | udhaar (bills), cash | upi (payments)
    tone: str = "soft"
    product_spec: Optional[dict] = None  # ADD_PRODUCT: name, unit, opening_stock, price_paise


def _clean(text: str) -> str:
    t = text.lower().replace("₹", " rs ")
    t = re.sub(r"[^a-z0-9.\s]", " ", t)
    t = re.sub(r"(?<!\d)\.|\.(?!\d)", " ", t)  # keep decimal points only
    return re.sub(r"\s+", " ", t).strip()


def normalise(text: str) -> str:
    return normalise_with_brands(text)[0]


def normalise_with_brands(text: str) -> tuple[str, dict[str, str]]:
    """Lower-cased Latin text with brand slang replaced ('fortune tel' -> 'fortune sunflower oil').
    Also returns {canonical: spoken} so the bill can show the conversion."""
    t = _clean(text)
    used: dict[str, str] = {}
    for spoken, canonical in BRAND_ALIASES.items():
        pattern = rf"(^| ){re.escape(spoken)}( |$)"
        if re.search(pattern, t):
            used[canonical] = spoken
            t = re.sub(pattern, rf"\g<1>{canonical}\g<2>", t)
    return t, used


def _has(text: str, pattern: str) -> bool:
    return re.search(pattern, text) is not None


# ---------------------------------------------------------------------------- names
def _name_keys(customer: CustomerRec) -> list[str]:
    keys = [customer.name.lower()] + [a.lower() for a in customer.aliases]
    return [k for k in keys if k]


def find_names(text: str, customers: list[CustomerRec]) -> list[str]:
    """Customer names heard, in order of appearance (lower case; may match several customers)."""
    words = text.split(" ")
    known: dict[str, str] = {}
    for c in customers:
        for key in _name_keys(c):
            known.setdefault(key, c.name.lower())
    found: list[tuple[int, str]] = []
    # multi-word aliases first ("ramesh anna")
    for key, name in known.items():
        if " " in key:
            for m in re.finditer(rf"(^| ){re.escape(key)}( |$)", text):
                found.append((text[: m.start()].count(" "), name))
    for index, w in enumerate(words):
        candidates = [w] + [w[: -len(s)] for s in NAME_SUFFIXES if w.endswith(s) and len(w) > len(s) + 2]
        hit = next((c for c in candidates if c in known), None)
        if hit and not any(i == index for i, _ in found):
            found.append((index, known[hit]))
    found.sort()
    out: list[str] = []
    for _, name in found:
        if not out or out[-1] != name:
            out.append(name)
    return out


def customers_named(name: str, customers: list[CustomerRec]) -> list[CustomerRec]:
    return [c for c in customers if name in _name_keys(c) or c.name.lower() == name]


# ---------------------------------------------------------------------------- products
def _product_keys(p: ProductRec) -> list[str]:
    name = p.name.lower()
    short = re.sub(r"\s+\d+(\.\d+)?\s*(kg|g|gm|ml|l|ltr|litre)$", "", name)  # "tata salt 1kg" -> "tata salt"
    keys = {name, short, *[a.lower() for a in p.aliases if a]}
    return sorted((k for k in keys if k), key=len, reverse=True)


def _fmt(q: Decimal) -> str:
    """Decimal('2.000') -> '2', Decimal('0.250') -> '0.25'."""
    return format(q.normalize(), "f")


def _qty(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.001")).normalize()


def find_items(text: str, products: list[ProductRec], brands: Optional[dict[str, str]] = None) -> list[ParsedItem]:
    pairs = [(p, key) for p in products for key in _product_keys(p)]
    pairs.sort(key=lambda x: len(x[1]), reverse=True)
    taken: list[tuple[int, int]] = []
    hits: list[tuple[int, ProductRec, str]] = []
    for product, key in pairs:
        for m in re.finditer(rf"(^| ){re.escape(key)}( |$)", text):
            start = m.start() + len(m.group(1))
            end = start + len(key)
            if any(start < e and end > s for s, e in taken):
                continue
            if any(p.id == product.id and abs(st - start) < 2 for st, p, _ in hits):
                continue
            taken.append((start, end))
            hits.append((start, product, key))
    hits.sort(key=lambda h: h[0])
    items: list[ParsedItem] = []
    for start, product, key in hits:
        before = text[:start].strip().split(" ")[-3:] if text[:start].strip() else []
        qty = Decimal("1")
        note = None
        unit_word = None
        spoken_unit = None
        for w in reversed(before):
            if w in UNITS and unit_word is None:
                unit_word = UNITS[w]
                spoken_unit = w
                continue
            if re.fullmatch(r"\d+(\.\d+)?", w):
                qty = Decimal(w)
                break
            if w in NUMBER_WORDS:
                qty = Decimal(NUMBER_WORDS[w])
                break
            if w in FRACTIONS:
                qty = Decimal(str(FRACTIONS[w]))
                note = f"{w}{' ' + spoken_unit if spoken_unit else ''} → {_fmt(qty)} {product.unit}"
                break
            if unit_word is None:
                break
        unit = product.unit.lower()
        if unit_word == "dozen" and unit in ("piece", "pcs"):
            note = f"{_fmt(qty)} dozen → {_fmt(qty * 12)} {product.unit}"
            qty = qty * 12
        elif unit_word == "g" and unit == "kg":
            note = f"{_fmt(qty)} g → {_fmt(_qty(qty / 1000))} kg"
            qty = qty / 1000
        elif unit_word == "seer" and unit == "kg":
            note = f"{_fmt(qty)} seer → {_fmt(_qty(qty * SEER_IN_KG))} kg"
            qty = qty * SEER_IN_KG
        if note is None:
            spoken_brand = next((sp for canon, sp in (brands or {}).items() if canon == key or canon in key or key in canon), None)
            if spoken_brand:
                note = f"{spoken_brand} → {product.name}"
            elif " " in key and not product.name.lower().startswith(key):
                note = f"{key} → {product.name}"
        items.append(ParsedItem(product=product, qty=_qty(qty), note=note))
    return items


# ---------------------------------------------------------------------------- amounts
def amount_paise(text: str) -> Optional[int]:
    """Rupee amount spoken in the sentence: '200', 'rs 150.50', 'do sau', 'dedh sau', 'eradu saavira'."""
    m = re.search(r"\d+(?:\.\d{1,2})?", text)
    words = text.split(" ")
    for i, w in enumerate(words):
        if w in MULTIPLIERS and i > 0:
            prev = words[i - 1]
            base = None
            if re.fullmatch(r"\d+(\.\d+)?", prev):
                base = Decimal(prev)
            elif prev in NUMBER_WORDS:
                base = Decimal(NUMBER_WORDS[prev])
            elif prev in FRACTIONS:
                base = Decimal(str(FRACTIONS[prev]))
            if base is not None:
                return int(base * MULTIPLIERS[w] * 100)
    if m:
        return int((Decimal(m.group(0)) * 100).to_integral_value())
    return None


# ---------------------------------------------------------------------------- intent
UNDO_RE = r"\bundo\b|galti|wapas karo|vaapas|hinde tago|cancel last|mistake"
CORRECTION_RE = r"\balla\b|\bnahi\b|\bnahin\b|\bnot\b|\bwrong\b|\billa\b"
REMINDER_RE = r"remind|reminder|yaad dila|nenapisu"
EXPLAIN_RE = r"samjha|explain|kaise|hisaab|hisab|lekka|breakup"
HISTORY_RE = r"history|itihas|timeline|purana|entries|record"
BALANCE_RE = r"baaki|baki|bakki|balance|kitna|eshtu|\bdue\b|outstanding"
PAYMENT_RE = r"\bdiye\b|\bdiya\b|\bpaid\b|\bpay\b|kotta|kottru|kottidare|kottidru|jama|payment|\bmila\b|received"
ADD_PRODUCT_RE = r"^(add|naya product|new product|hosa product|product add)\b"
# Credit GIVEN to the customer. "Ramesh ko 500 udhaar diya" uses the same verb (diya) as a payment
# ("Ramesh ne 500 diye") but means the opposite, so udhaar wording must never become a payment.
UDHAAR_RE = r"udhaar|udhar|khata|credit|saala"  # bill mode words
UDHAAR_GIVEN_RE = r"udhaar|udhar|udhari|credit|saala"  # not "khata": "khata mein 200 jama" IS a payment


def _bill_mode(text: str) -> Optional[str]:
    if _has(text, r"\bupi\b|gpay|phonepe|paytm"):
        return "upi"
    if _has(text, r"\bcash\b|nagad|nakad"):
        return "cash"
    if _has(text, UDHAAR_RE):
        return "udhaar"
    return None


def is_udhaar_without_items(raw_text: str) -> bool:
    """'Ramesh ko 500 rupaye udhaar diya': credit with an amount but no items (not a valid entry on its own)."""
    return _has(normalise(raw_text), UDHAAR_GIVEN_RE)


PRICE_RE = r"(?:rs|rupees?|rupaye|rupay)\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:rs|rupees?|rupaye|rupay)"


def _product_spec(text: str) -> Optional[dict]:
    """'add tata salt 1 kg' -> name 'Tata Salt', unit 'kg', opening stock 1, price unknown."""
    price_m = re.search(PRICE_RE, text)
    price = int(Decimal(price_m.group(1) or price_m.group(2)) * 100) if price_m else None
    rest = re.sub(ADD_PRODUCT_RE, "", text).strip()
    rest = re.sub(PRICE_RE, "", rest).strip()
    qty_m = re.search(r"(\d+(?:\.\d+)?)\s*(kg|kilo|g|gram|l|litre|liter|packet|pack|piece|pcs)?\s*$", rest)
    name = (rest[: qty_m.start()] if qty_m else rest).strip()
    if not name:
        return None
    unit_raw = qty_m.group(2) if qty_m and qty_m.group(2) else "pcs"
    unit = {"kilo": "kg", "gram": "g", "liter": "litre", "l": "litre", "pack": "packet"}.get(unit_raw, unit_raw)
    return {
        "name": " ".join(w.capitalize() for w in name.split()),
        "unit": unit,
        "opening_stock": str(Decimal(qty_m.group(1))) if qty_m else None,
        "price_paise": price,
    }


def parse(raw_text: str, customers: list[CustomerRec], products: list[ProductRec], *, has_open_draft: bool = False) -> Parsed:
    text, brands = normalise_with_brands(raw_text)
    transcript = raw_text.strip()
    names = find_names(text, customers)
    tone = "firm" if _has(text, r"firm|strict|kadak|sakht") else "soft"

    if _has(text, UNDO_RE):
        return Parsed("UNDO", transcript, names)
    if names and _has(text, CORRECTION_RE):
        return Parsed("CORRECT_CUSTOMER", transcript, names)
    for pattern, intent in ((REMINDER_RE, "SEND_REMINDER"), (EXPLAIN_RE, "EXPLAIN_BALANCE"), (HISTORY_RE, "SHOW_HISTORY"), (BALANCE_RE, "SHOW_BALANCE")):
        if _has(text, pattern):
            return Parsed(intent, transcript, names, tone=tone)
    if _has(text, PAYMENT_RE) and not _has(text, UDHAAR_GIVEN_RE):
        mode = "upi" if _has(text, r"\bupi\b|gpay|phonepe|paytm") else "cash"
        return Parsed("RECORD_PAYMENT", transcript, names, amount_paise=amount_paise(text), mode=mode)
    items = find_items(text, products, brands)
    if has_open_draft and items and not names:
        return Parsed("ADD_ITEM", transcript, names, items=items)
    if _has(text, ADD_PRODUCT_RE) and not names:
        spec = _product_spec(text)
        if spec:
            return Parsed("ADD_PRODUCT", transcript, names, product_spec=spec)
    if items:
        return Parsed("CREATE_BILL", transcript, names, items=items, mode=_bill_mode(text))
    return Parsed("UNKNOWN", transcript, names)


def detect_intent(raw_text: str) -> str:
    """Intent from the words alone (no shop data). Used by the legacy /voice/process alias."""
    text = normalise(raw_text)
    for pattern, intent in (
        (UNDO_RE, "UNDO"), (REMINDER_RE, "SEND_REMINDER"), (EXPLAIN_RE, "EXPLAIN_BALANCE"),
        (HISTORY_RE, "SHOW_HISTORY"), (BALANCE_RE, "SHOW_BALANCE"), (PAYMENT_RE, "RECORD_PAYMENT"),
        (ADD_PRODUCT_RE, "ADD_PRODUCT"),
    ):
        if _has(text, pattern):
            return intent
    if _has(text, r"\bsold\b|\bsale\b|\bbill\b|\bmaadu\b|\bdo\b|\bdedo\b|\bkodi\b") or re.search(r"\d", text):
        return "CREATE_BILL"
    return "UNKNOWN"
