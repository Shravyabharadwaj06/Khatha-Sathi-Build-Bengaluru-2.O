"""Reply texts in Hindi / Kannada / English (Latin letters).

Guardrail: every number in a reply comes from the database or from code (totals in paise).
The LLM never writes reply text. Rupees are formatted by `rupees()`.
"""
from decimal import Decimal

MODE_WORD = {
    "hi": {"udhaar": "udhaar", "cash": "cash", "upi": "UPI", "partial": "thoda udhaar"},
    "kn": {"udhaar": "saala", "cash": "cash", "upi": "UPI", "partial": "swalpa saala"},
    "en": {"udhaar": "on credit", "cash": "cash", "upi": "UPI", "partial": "part paid"},
}
ASK = {"hi": "Confirm karein?", "kn": "Confirm maadla?", "en": "Confirm?"}

TEXT = {
    "not_understood": {"hi": "Samajh nahi aaya. Phir se boliye?", "kn": "Arthavaagalilla. Innondu sala heli?", "en": "Sorry, I didn't get that. Please say it again."},
    "no_customer": {"hi": "Kis customer ka? Naam boliye.", "kn": "Yaava customer? Hesaru heli.", "en": "Which customer? Please say the name."},
    "customer_unknown": {"hi": "Is naam ka customer nahi mila.", "kn": "Ee hesarina customer sigalilla.", "en": "No customer with that name was found."},
    "no_draft": {"hi": "Abhi koi bill khula nahi hai. Pehle bill boliye.", "kn": "Yaava bill open illa. Modalu bill heli.", "en": "There is no open bill. Say the bill first."},
    "nothing_to_undo": {"hi": "Wapas karne ke liye kuch nahi hai.", "kn": "Vaapas maadalu enu illa.", "en": "There is nothing to undo."},
    "reminder_ready": {"hi": "Reminder taiyaar hai. WhatsApp kholkar bhejiye.", "kn": "Reminder ready ide. WhatsApp open maadi kalisi.", "en": "Reminder is ready. Open WhatsApp to send it."},
    "no_amount": {"hi": "Kitne rupaye mile? Raqam boliye.", "kn": "Eshtu rupaayi? Mottavannu heli.", "en": "How much was paid? Please say the amount."},
    "udhaar_needs_items": {"hi": "Udhaar bill ke saath likha jaata hai. Saaman boliye, jaise: Ramesh ko 2 Tata Salt udhaar.",
                           "kn": "Saala bill jothe barediduttade. Vastu heli, udaharane: Ramesh ge 2 Tata Salt saala.",
                           "en": "Udhaar is recorded as a bill. Say what was bought, e.g. 'Ramesh ko 2 Tata Salt udhaar'."},
    "no_price": {"hi": "Is saaman ka daam set nahi hai.", "kn": "Ee vastuvina bele set aagilla.", "en": "This item has no price set yet."},
    "saved": {"hi": "Save ho gaya.", "kn": "Save aaytu.", "en": "Saved."},
}


def lang(language: str | None) -> str:
    code = (language or "hi").split("-")[0].lower()
    return code if code in ("hi", "kn", "en") else "hi"


def t(key: str, language: str) -> str:
    return TEXT[key][lang(language)]


def rupees(paise: int) -> str:
    """84000 -> '₹840', 5450 -> '₹54.50' (Indian digit grouping)."""
    sign = "-" if paise < 0 else ""
    whole, rest = divmod(abs(int(paise)), 100)
    digits = str(whole)
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        digits = ",".join(([head] if head else []) + groups) + "," + tail
    return f"{sign}₹{digits}" + (f".{rest:02d}" if rest else "")


def qty(value) -> str:
    return format(Decimal(str(value)).normalize(), "f")


def who(customer: dict | None) -> str:
    if not customer:
        return "Cash sale"
    return f"{customer['name']}{' (' + customer['locality'] + ')' if customer.get('locality') else ''}"


def items_short(items: list[dict]) -> str:
    return ", ".join(f"{qty(i['qty'])} {i['name']}" for i in items)


def bill(draft: dict, language: str) -> str:
    l = lang(language)
    return f"{who(draft['customer'])}: {items_short(draft['items'])}, {rupees(draft['total_paise'])} {MODE_WORD[l][draft['payment_mode']]}. {ASK[l]}"


def corrected(draft: dict, language: str) -> str:
    l = lang(language)
    w = who(draft["customer"])
    return {
        "hi": f"Theek hai, {w} ke naam. {rupees(draft['total_paise'])}. {ASK['hi']}",
        "kn": f"Sari, {w} hesarige. {rupees(draft['total_paise'])}. {ASK['kn']}",
        "en": f"OK, changed to {w}. {rupees(draft['total_paise'])}. Confirm?",
    }[l]


def payment(draft: dict, language: str) -> str:
    l = lang(language)
    w, amt, mode = who(draft["customer"]), rupees(draft["total_paise"]), draft["payment_mode"]
    return {
        "hi": f"{w} se {amt} {MODE_WORD['hi'][mode]} mila. {ASK['hi']}",
        "kn": f"{w} {amt} {MODE_WORD['kn'][mode]} kottiddare. {ASK['kn']}",
        "en": f"{w} paid {amt} by {mode}. Confirm?",
    }[l]


def product(spec: dict, language: str) -> str:
    l = lang(language)
    price = spec.get("selling_price_paise")
    return {
        "hi": f"Naya product: {spec['name']}. {'Daam abhi nahi bataya.' if price is None else 'Daam ' + rupees(price) + '.'} {ASK['hi']}",
        "kn": f"Hosa product: {spec['name']}. {'Bele innoo heliilla.' if price is None else 'Bele ' + rupees(price) + '.'} {ASK['kn']}",
        "en": f"New product: {spec['name']}. {'No price yet.' if price is None else 'Price ' + rupees(price) + '.'} Confirm?",
    }[l]


def undo(amount_paise: int, language: str) -> str:
    l = lang(language)
    return {
        "hi": f"Ye entry wapas karni hai: {rupees(amount_paise)}. {ASK['hi']}",
        "kn": f"Ee entry vaapas maadbeka: {rupees(amount_paise)}. {ASK['kn']}",
        "en": f"Reverse this entry of {rupees(amount_paise)}? Confirm?",
    }[l]


def clarify(name: str, details: list[str], language: str) -> str:
    l = lang(language)
    return {
        "hi": f"Kaunsa {name}? {' ya '.join(details)}?",
        "kn": f"Yaava {name}? {' athava '.join(details)}?",
        "en": f"Which {name}? {' or '.join(details)}?",
    }[l]


def balance(name: str, paise: int, language: str) -> str:
    return {
        "hi": f"{name} ka baaki {rupees(paise)} hai.",
        "kn": f"{name} avara baaki {rupees(paise)}.",
        "en": f"{name} owes {rupees(paise)}.",
    }[lang(language)]


def explain(name: str, deltas: list[int], total: int, language: str) -> str:
    parts = "".join(
        f"{'' if i == 0 else (' − ' if d < 0 else ' + ')}{'− ' if i == 0 and d < 0 else ''}{rupees(abs(d))}" for i, d in enumerate(deltas)
    )
    return {
        "hi": f"{name} ka hisaab: {parts} = {rupees(total)}.",
        "kn": f"{name} lekka: {parts} = {rupees(total)}.",
        "en": f"{name}'s account: {parts} = {rupees(total)}.",
    }[lang(language)]


def history(name: str, count: int, paise: int, language: str) -> str:
    return {
        "hi": f"{name} ki {count} entries. Abhi baaki {rupees(paise)}.",
        "kn": f"{name} avara {count} entries. Eega baaki {rupees(paise)}.",
        "en": f"{name}: {count} entries, {rupees(paise)} due now.",
    }[lang(language)]


def saved(customer: dict | None, balance_paise: int | None, language: str) -> str:
    l = lang(language)
    if not customer or balance_paise is None:
        return TEXT["saved"][l]
    w = who(customer)
    return {
        "hi": f"Save ho gaya. {w} ka naya baaki {rupees(balance_paise)}.",
        "kn": f"Save aaytu. {w} avara hosa baaki {rupees(balance_paise)}.",
        "en": f"Saved. {w} now owes {rupees(balance_paise)}.",
    }[l]


def product_added(name: str, language: str) -> str:
    return {"hi": f"{name} jod diya.", "kn": f"{name} serisalaayitu.", "en": f"{name} added."}[lang(language)]
