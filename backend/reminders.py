"""Payment-reminder messages and WhatsApp links.

Messages are fixed templates filled ONLY with database values (customer name, shop name,
balance). Nothing is sent automatically: the shopkeeper opens the wa.me link and presses
Send in WhatsApp. Used by GET /customers/{id}/whatsapp and by the voice assistant.
"""
from urllib.parse import quote

TONES = ("soft", "firm")
LANGUAGES = ("en", "hi", "kn")

_TEMPLATES = {
    "en": {
        "soft": "Hello {name}, a friendly reminder that {amount} is due at {shop}. Please pay when you can. Thank you!",
        "firm": "{name}, {amount} is overdue at {shop}. Please clear it this week.",
    },
    "hi": {
        "soft": "Namaste {name} ji, {shop} mein aapka {amount} baaki hai. Jab ho sake, de dijiye. Dhanyavaad!",
        "firm": "{name} ji, aapka {amount} baaki hai. Kripya is hafte tak jama kar dijiye. - {shop}",
    },
    "kn": {
        "soft": "Namaskara {name} avare, {shop} nalli nimma {amount} baaki ide. Saadhyavaadaga kodi. Dhanyavaadagalu!",
        "firm": "{name} avare, nimma {amount} baaki ide. Dayavittu ee vaara kattibidi. - {shop}",
    },
}


def language_code(language: str | None) -> str:
    """'hi-IN' / 'hi' -> 'hi'; anything unknown -> 'en'."""
    code = (language or "en").split("-")[0].lower()
    return code if code in LANGUAGES else "en"


def reminder_text(*, name: str, shop: str, amount_text: str, tone: str = "soft", language: str = "en") -> str:
    tone = tone if tone in TONES else "soft"
    return _TEMPLATES[language_code(language)][tone].format(name=name, shop=shop or "our shop", amount=amount_text)


def whatsapp_number(whatsapp: str | None, phone: str | None) -> str | None:
    """10-digit Indian number from the WhatsApp field, else the phone field."""
    for value in (whatsapp, phone):
        digits = "".join(ch for ch in (value or "") if ch.isdigit())
        if len(digits) == 12 and digits.startswith("91"):
            digits = digits[2:]
        if len(digits) == 10:
            return digits
    return None


def whatsapp_url(number: str, message: str) -> str:
    return f"https://wa.me/91{number}?text={quote(message)}"
