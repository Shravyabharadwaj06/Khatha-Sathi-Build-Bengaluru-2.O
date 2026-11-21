"""Optional LLM intent parser (any OpenAI-compatible chat-completions API: Gemini, Groq, OpenAI...).

Guardrails:
- The LLM only turns TEXT into a structured action. It never computes totals or balances and its
  words never reach the shopkeeper: replies are templates filled with database values.
- Only the transcript plus this shop's customer and product NAMES are sent. Never audio, never amounts
  from the database, never phone numbers.
- The JSON answer is validated with Pydantic; one retry; anything else -> rules parser.
"""
import json
import logging
from decimal import Decimal
from typing import Literal, Optional

import httpx
from pydantic import BaseModel, Field, ValidationError

from . import parser
from .config import VoiceSettings

logger = logging.getLogger(__name__)

LlmIntent = Literal[
    "CREATE_BILL", "ADD_ITEM", "CORRECT_CUSTOMER", "RECORD_PAYMENT", "SHOW_BALANCE", "EXPLAIN_BALANCE",
    "SHOW_HISTORY", "SEND_REMINDER", "ADD_PRODUCT", "UNDO", "UNKNOWN",
]


class LlmItem(BaseModel):
    product: str = Field(min_length=1, max_length=120)
    qty: Decimal = Field(gt=0, le=10000)


class LlmProduct(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    unit: str = Field(default="pcs", max_length=20)
    price_rupees: Optional[Decimal] = Field(default=None, ge=0, le=1_000_000)
    opening_stock: Optional[Decimal] = Field(default=None, ge=0, le=100_000)


class LlmCommand(BaseModel):
    intent: LlmIntent
    customer: Optional[str] = Field(default=None, max_length=120)
    new_customer: Optional[str] = Field(default=None, max_length=120)  # CORRECT_CUSTOMER: the right name
    items: list[LlmItem] = Field(default_factory=list, max_length=30)
    amount_rupees: Optional[Decimal] = Field(default=None, gt=0, le=1_000_000)  # as SPOKEN, for payments
    payment_mode: Optional[Literal["cash", "upi", "udhaar"]] = None
    tone: Literal["soft", "firm"] = "soft"
    product: Optional[LlmProduct] = None


SYSTEM = """You convert a kirana shopkeeper's words (Hindi, Kannada, English or mixed) into ONE JSON object.
Do not calculate anything. Copy quantities and rupee amounts exactly as spoken (convert words like 'do sau' to 200).
Use only customer and product names from the lists given; if unsure, leave the field empty.
JSON keys: intent (CREATE_BILL, ADD_ITEM, CORRECT_CUSTOMER, RECORD_PAYMENT, SHOW_BALANCE, EXPLAIN_BALANCE,
SHOW_HISTORY, SEND_REMINDER, ADD_PRODUCT, UNDO, UNKNOWN), customer, new_customer, items [{product, qty}],
amount_rupees, payment_mode (cash|upi|udhaar), tone (soft|firm), product {name, unit, price_rupees, opening_stock}.
Reply with the JSON object only."""


def _ask(settings: VoiceSettings, messages: list[dict], client: Optional[httpx.Client]) -> str:
    http = client or httpx.Client(timeout=15)
    try:
        response = http.post(
            f"{settings.llm_base_url}/chat/completions",
            headers={"Authorization": f"Bearer {settings.llm_api_key}"},
            json={"model": settings.llm_model, "messages": messages, "temperature": 0, "response_format": {"type": "json_object"}},
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]
    finally:
        if client is None:
            http.close()


def llm_command(
    text: str,
    customers: list[parser.CustomerRec],
    products: list[parser.ProductRec],
    settings: VoiceSettings,
    client: Optional[httpx.Client] = None,
) -> Optional[LlmCommand]:
    """Returns a validated command, or None (caller then uses the rules parser)."""
    if not (settings.llm_base_url and settings.llm_api_key and settings.llm_model):
        return None
    context = {
        "customers": sorted({c.name for c in customers})[:200],
        "products": sorted({p.name for p in products})[:300],
    }
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": json.dumps({"text": text, **context}, ensure_ascii=False)},
    ]
    for attempt in (1, 2):
        try:
            raw = _ask(settings, messages, client)
            return LlmCommand.model_validate_json(raw)
        except ValidationError as error:
            logger.info("LLM answer rejected (attempt %s): %s", attempt, error.errors()[:1])
            messages.append({"role": "user", "content": "That was not valid. Reply with ONE JSON object using only the allowed keys and values."})
        except (httpx.HTTPError, KeyError, ValueError) as error:
            logger.warning("LLM unavailable: %s", type(error).__name__)
            return None
    return None


def to_parsed(cmd: LlmCommand, text: str, customers: list[parser.CustomerRec], products: list[parser.ProductRec]) -> parser.Parsed:
    """Maps the LLM's names onto this shop's records with the same matching the rules use."""
    names = [n.lower() for n in (cmd.customer, cmd.new_customer) if n]
    items: list[parser.ParsedItem] = []
    for item in cmd.items:
        match = parser.find_items(parser.normalise(item.product), products)
        if match:
            items.append(parser.ParsedItem(product=match[0].product, qty=item.qty.quantize(Decimal("0.001")).normalize()))
    spec = None
    if cmd.intent == "ADD_PRODUCT" and cmd.product:
        spec = {
            "name": cmd.product.name.strip(),
            "unit": cmd.product.unit or "pcs",
            "opening_stock": str(cmd.product.opening_stock) if cmd.product.opening_stock is not None else None,
            "price_paise": int(cmd.product.price_rupees * 100) if cmd.product.price_rupees is not None else None,
        }
    return parser.Parsed(
        intent=cmd.intent,
        transcript=text.strip(),
        names=names,
        items=items,
        amount_paise=int(cmd.amount_rupees * 100) if cmd.amount_rupees is not None else None,
        mode=cmd.payment_mode,
        tone=cmd.tone,
        product_spec=spec,
    )
