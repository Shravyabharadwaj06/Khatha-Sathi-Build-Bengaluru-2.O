"""The voice assistant flow (docs/VOICE_CONTRACT.md).

/voice/command  -> (Gnani STT if audio) -> understand -> resolve against this shop -> totals IN CODE
                -> draft (assistant_drafts) / clarify / answer / error.  Nothing touches the ledger here.
/voice/confirm  -> the ONLY write: same helpers as the normal endpoints, one DB transaction.
"""
import logging
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

import reminders

from . import llm, parser, providers, templates as T
from .config import VoiceSettings
from .parser import CustomerRec, Parsed, ParsedItem, ProductRec
from .providers import Clip, VoiceError, gnani_slot
from .store import Ctx, VoiceStore

logger = logging.getLogger(__name__)
LANGUAGES = ("hi-IN", "kn-IN", "en-IN")
DRAFT_INTENTS = {"CREATE_BILL", "ADD_ITEM", "CORRECT_CUSTOMER", "RECORD_PAYMENT", "SEND_REMINDER", "ADD_PRODUCT", "UNDO"}


# ---------------------------------------------------------------------------- small helpers
def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _line_total(qty: Decimal, price: Optional[int]) -> Optional[int]:
    if price is None:
        return None
    return int((qty * price).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _ref(c: CustomerRec) -> dict:
    return {"id": c.id, "name": c.name, "locality": c.locality}


def response(transcript: str, language: str, intent: str, status: str, *, draft=None, clarify=None, answer=None,
             reply: str = "", error=None) -> dict:
    return {
        "transcript": transcript, "language": language, "status": status, "intent": intent,
        "draft": draft, "clarify": clarify, "answer": answer, "reply_text": reply, "error": error,
    }


def error_response(transcript: str, language: str, intent: str, code: str, reply: str, message: Optional[str] = None) -> dict:
    return response(transcript, language, intent, "error", reply=reply, error={"code": code, "message": message or reply})


# ---------------------------------------------------------------------------- clarify questions (in memory, 10 min)
class _ClarifyStore:
    def __init__(self, ttl: float = 600, size: int = 500):
        self.ttl, self.size = ttl, size
        self.items: "OrderedDict[str, dict]" = OrderedDict()

    def put(self, ctx: Ctx, data: dict) -> str:
        key = str(uuid.uuid4())
        self.items[key] = {"ctx": ctx, "at": time.monotonic(), **data}
        while len(self.items) > self.size:
            self.items.popitem(last=False)
        return key

    def take(self, ctx: Ctx, key: str) -> Optional[dict]:
        data = self.items.get(key)
        if not data or data["ctx"] != ctx or time.monotonic() - data["at"] > self.ttl:
            return None
        return self.items.pop(key)


CLARIFY = _ClarifyStore()


# ---------------------------------------------------------------------------- TTS cache (identical short replies)
class _TtsCache:
    def __init__(self, size: int = 200):
        self.size = size
        self.items: "OrderedDict[tuple[str, str], tuple[bytes, str]]" = OrderedDict()

    def get(self, key):
        if key in self.items:
            self.items.move_to_end(key)
            return self.items[key]
        return None

    def put(self, key, value):
        self.items[key] = value
        while len(self.items) > self.size:
            self.items.popitem(last=False)


TTS_CACHE = _TtsCache()


# ---------------------------------------------------------------------------- the service
@dataclass
class VoiceService:
    store: VoiceStore
    settings: VoiceSettings
    ctx: Ctx

    # .................................................................. speech -> text
    def _check_daily_limit(self, extra_seconds: float) -> None:
        used = self.store.gnani_usage_today()["seconds"]
        if used + extra_seconds > self.settings.daily_limit_seconds:
            raise VoiceError(429, "DAILY_LIMIT_REACHED", "Today's voice limit is reached. Type, or use the browser voice.")

    def transcribe(self, clip: Clip, language: str) -> tuple[str, str]:
        asr = providers.make_asr(self.settings)
        if asr.name == "mock":
            result = asr.transcribe(clip, language)
            return result.text, result.language or language
        self._check_daily_limit(clip.seconds)
        with gnani_slot(self.settings.lock_wait_seconds):
            try:
                result = asr.transcribe(clip, language)
            except VoiceError:
                self.store.log_usage(self.ctx, "transcribe", asr.name, clip.seconds, 0, False)
                raise
        self.store.log_usage(self.ctx, "transcribe", asr.name, clip.seconds, 0, True)
        detected = result.language if result.language in LANGUAGES else language
        return result.text, detected

    # .................................................................. understanding
    def understand(self, text: str, customers, products, has_open_draft: bool) -> Parsed:
        mode = self.settings.intent_mode
        if mode in ("llm", "auto"):
            cmd = llm.llm_command(text, customers, products, self.settings)
            if cmd is not None:
                parsed = llm.to_parsed(cmd, text, customers, products)
                if parsed.intent != "UNKNOWN" or mode == "llm":
                    return parsed
        return parser.parse(text, customers, products, has_open_draft=has_open_draft)

    # .................................................................. /voice/command
    def command(self, *, text: Optional[str], clip: Optional[Clip], language: str, draft_id: Optional[str]) -> dict:
        if text and text.strip():
            transcript = text.strip()[:500]
        elif clip is not None:
            transcript, language = self.transcribe(clip, language)
        else:
            raise VoiceError(400, "BAD_REQUEST", "Send audio or text.")

        customers = self.store.customers(self.ctx.shop_id)
        products = self.store.products(self.ctx.shop_id)
        open_draft = self._open_draft(draft_id)
        parsed = self.understand(transcript, customers, products, has_open_draft=open_draft is not None)
        return self._dispatch(parsed, language, customers, products, open_draft)

    def _open_draft(self, draft_id: Optional[str]) -> Optional[dict]:
        if not draft_id:
            return None
        draft = self.store.get_draft(self.ctx, draft_id)
        if not draft or draft["status"] != "pending":
            return None
        if draft["expires_at"] <= datetime.now(timezone.utc):
            self.store.set_draft_status(self.ctx, draft["id"], "expired")
            return None
        return draft

    def _dispatch(self, p: Parsed, language: str, customers, products, open_draft: Optional[dict]) -> dict:
        tr = p.transcript
        if p.intent == "UNDO":
            entry_id = self.store.last_undoable_entry(self.ctx.shop_id, self.ctx.user_id)
            if not entry_id:
                return error_response(tr, language, "UNDO", "NOTHING_TO_UNDO", T.t("nothing_to_undo", language))
            return self.undo_draft(entry_id, language, transcript=tr)

        if p.intent == "CORRECT_CUSTOMER":
            if not open_draft or open_draft["payload"]["exec"]["kind"] not in ("sale", "payment"):
                return error_response(tr, language, "CORRECT_CUSTOMER", "NO_OPEN_DRAFT", T.t("no_draft", language))
            target = p.names[-1]
            return self._with_customer(target, customers, tr, language, "CORRECT_CUSTOMER",
                                       {"action": "correct", "draft_id": open_draft["id"]})

        if p.intent in ("SHOW_BALANCE", "EXPLAIN_BALANCE", "SHOW_HISTORY", "SEND_REMINDER"):
            if not p.names:
                return error_response(tr, language, p.intent, "CUSTOMER_NOT_FOUND", T.t("no_customer", language))
            return self._with_customer(p.names[0], customers, tr, language, p.intent, {"action": "answer", "tone": p.tone})

        if p.intent == "RECORD_PAYMENT":
            if not p.names:
                return error_response(tr, language, p.intent, "CUSTOMER_NOT_FOUND", T.t("no_customer", language))
            if not p.amount_paise:
                return error_response(tr, language, p.intent, "NOT_UNDERSTOOD", T.t("no_amount", language))
            return self._with_customer(p.names[0], customers, tr, language, p.intent,
                                       {"action": "payment", "amount_paise": p.amount_paise, "mode": p.mode or "cash"})

        if p.intent == "ADD_ITEM" and open_draft and open_draft["payload"]["exec"]["kind"] == "sale":
            return self._add_items(open_draft, p.items, tr, language)

        if p.intent == "ADD_PRODUCT" and p.product_spec:
            return self._product_draft(p.product_spec, tr, language)

        if p.intent in ("CREATE_BILL", "ADD_ITEM") and p.items:
            data = {"action": "bill", "items": _items_json(p.items), "mode": p.mode}
            if not p.names:
                return self._bill_draft(None, data, products, tr, language)
            return self._with_customer(p.names[0], customers, tr, language, "CREATE_BILL", data)

        return error_response(tr, language, "UNKNOWN", "NOT_UNDERSTOOD", T.t("not_understood", language),
                              "Could not understand the request.")

    # .................................................................. customer resolution + clarify
    def _with_customer(self, name: str, customers, tr: str, language: str, intent: str, data: dict) -> dict:
        matches = parser.customers_named(name, customers)
        if not matches:
            return error_response(tr, language, intent, "CUSTOMER_NOT_FOUND", T.t("customer_unknown", language))
        if len(matches) == 1:
            return self._resolve(matches[0], data, tr, language, intent)
        options = [{"id": c.id, "label": c.name, "detail": _detail(c)} for c in matches]
        question = T.clarify(matches[0].name, [o["detail"] for o in options], language)
        key = CLARIFY.put(self.ctx, {"data": data, "transcript": tr, "language": language, "intent": intent,
                                     "options": [o["id"] for o in options]})
        clarify = {"clarify_id": key, "kind": "customer", "question": question, "options": options}
        return response(tr, language, intent, "clarify", clarify=clarify, reply=question)

    def choose(self, clarify_id: str, option_id: str) -> dict:
        pending = CLARIFY.take(self.ctx, clarify_id)
        if not pending or option_id not in pending["options"]:
            raise VoiceError(404, "DRAFT_NOT_FOUND", "That question has expired. Please speak again.")
        customers = self.store.customers(self.ctx.shop_id)
        chosen = next((c for c in customers if c.id == option_id), None)
        if chosen is None:
            raise VoiceError(404, "CUSTOMER_NOT_FOUND", "That customer was not found.")
        return self._resolve(chosen, pending["data"], pending["transcript"], pending["language"], pending["intent"])

    def _resolve(self, customer: CustomerRec, data: dict, tr: str, language: str, intent: str) -> dict:
        action = data["action"]
        if action == "bill":
            return self._bill_draft(customer, data, self.store.products(self.ctx.shop_id), tr, language)
        if action == "payment":
            return self._payment_draft(customer, data, tr, language)
        if action == "correct":
            return self._correct(customer, data["draft_id"], tr, language)
        return self._answer(customer, intent, data.get("tone", "soft"), tr, language)

    # .................................................................. drafts
    def _save_draft(self, intent: str, draft: dict, spec: dict, tr: str, language: str, draft_id: Optional[str] = None) -> dict:
        payload = {"draft": draft, "exec": spec, "language": language}
        if draft_id:
            expires = self.store.update_draft(self.ctx, draft_id, intent, payload, self.settings.draft_minutes)
        else:
            draft_id, expires = self.store.create_draft(self.ctx, intent, payload, tr, self.settings.draft_minutes)
        return {**draft, "draft_id": draft_id, "intent": intent, "expires_at": _iso(expires)}

    def _bill_draft(self, customer: Optional[CustomerRec], data: dict, products, tr: str, language: str,
                    draft_id: Optional[str] = None, changes: Optional[list] = None, intent: str = "CREATE_BILL") -> dict:
        by_id = {p.id: p for p in products}
        items, warnings = [], []
        for raw in data["items"]:
            product = by_id.get(raw["product_id"])
            if product is None:
                continue
            qty = Decimal(raw["qty"])
            items.append({
                "product_id": product.id, "name": product.name, "qty": float(qty), "unit": product.unit,
                "unit_price_paise": product.price_paise, "line_total_paise": _line_total(qty, product.price_paise),
                "conversion_note": raw.get("note"),
            })
            if product.price_paise is None:
                warnings.append(f"Price not set for {product.name}")
            if qty > product.stock:
                warnings.append(f"Only {T.qty(product.stock)} {product.unit} {product.name} in stock")
        if not items:
            return error_response(tr, language, intent, "PRODUCT_NOT_FOUND", T.t("not_understood", language))
        total = sum(i["line_total_paise"] or 0 for i in items)
        mode = data.get("mode") or ("udhaar" if customer else "cash")
        if customer is None and mode == "udhaar":
            mode = "cash"
            warnings.append("Walk-in bills are paid in full. Say the customer's name for udhaar.")
        draft = {
            "customer": _ref(customer) if customer else None, "items": items, "total_paise": total,
            "payment_mode": mode, "paid_paise": 0 if mode == "udhaar" else total, "reverses_entry_id": None,
            "product": None, "changes": changes or [], "warnings": warnings,
        }
        spec = {
            "kind": "sale", "customer_id": customer.id if customer else None, "method": mode,
            "items": [[i["product_id"], str(Decimal(str(i["qty"])))] for i in items],
        }
        saved = self._save_draft(intent, draft, spec, tr, language, draft_id)
        reply = T.corrected(saved, language) if intent == "CORRECT_CUSTOMER" else T.bill(saved, language)
        return response(tr, language, intent, "draft", draft=saved, reply=reply)

    def _add_items(self, open_draft: dict, new_items: list[ParsedItem], tr: str, language: str) -> dict:
        payload = open_draft["payload"]
        old = payload["draft"]
        customer = None
        if old["customer"]:
            customer = next((c for c in self.store.customers(self.ctx.shop_id) if c.id == old["customer"]["id"]), None)
        data = {
            "action": "bill", "mode": old["payment_mode"],
            "items": [{"product_id": i["product_id"], "qty": str(i["qty"]), "note": i.get("conversion_note")} for i in old["items"]]
                     + _items_json(new_items),
        }
        changes = [f"Added: {T.qty(i.qty)} {i.product.name}" for i in new_items]
        return self._bill_draft(customer, data, self.store.products(self.ctx.shop_id), tr, language,
                                draft_id=open_draft["id"], changes=changes, intent="ADD_ITEM")

    def _correct(self, customer: CustomerRec, draft_id: str, tr: str, language: str) -> dict:
        open_draft = self._open_draft(draft_id)
        if not open_draft:
            return error_response(tr, language, "CORRECT_CUSTOMER", "NO_OPEN_DRAFT", T.t("no_draft", language))
        old = open_draft["payload"]["draft"]
        before = old["customer"]["name"] if old["customer"] else "Cash sale"
        if open_draft["payload"]["exec"]["kind"] == "payment":
            data = {"action": "payment", "amount_paise": old["total_paise"], "mode": old["payment_mode"]}
            return self._payment_draft(customer, data, tr, language, draft_id=open_draft["id"],
                                       changes=[f"Customer: {before} → {customer.name}"], intent="CORRECT_CUSTOMER")
        mode = old["payment_mode"]
        if not old["customer"] and mode == "cash":
            mode = "udhaar"
        data = {"action": "bill", "mode": mode,
                "items": [{"product_id": i["product_id"], "qty": str(i["qty"]), "note": i.get("conversion_note")} for i in old["items"]]}
        return self._bill_draft(customer, data, self.store.products(self.ctx.shop_id), tr, language,
                                draft_id=open_draft["id"], changes=[f"Customer: {before} → {customer.name}"], intent="CORRECT_CUSTOMER")

    def _payment_draft(self, customer: CustomerRec, data: dict, tr: str, language: str, draft_id: Optional[str] = None,
                       changes: Optional[list] = None, intent: str = "RECORD_PAYMENT") -> dict:
        amount = int(data["amount_paise"])
        due = self.store.balance(self.ctx.shop_id, customer.id)
        if amount > due:
            message = f"Payment is more than the due amount ({T.rupees(max(due, 0))})."
            return error_response(tr, language, intent, "PAYMENT_MORE_THAN_DUE", message)
        mode = data.get("mode") if data.get("mode") in ("cash", "upi") else "cash"
        draft = {
            "customer": _ref(customer), "items": [], "total_paise": amount, "payment_mode": mode, "paid_paise": amount,
            "reverses_entry_id": None, "product": None, "changes": changes or [], "warnings": [],
        }
        spec = {"kind": "payment", "customer_id": customer.id, "amount_paise": amount, "method": mode}
        saved = self._save_draft(intent, draft, spec, tr, language, draft_id)
        reply = T.corrected(saved, language) if intent == "CORRECT_CUSTOMER" else T.payment(saved, language)
        return response(tr, language, intent, "draft", draft=saved, reply=reply)

    def _product_draft(self, spec_in: dict, tr: str, language: str) -> dict:
        price = spec_in.get("price_paise")
        product = {"name": spec_in["name"], "unit": spec_in.get("unit") or "pcs", "selling_price_paise": price,
                   "opening_stock": float(Decimal(spec_in["opening_stock"])) if spec_in.get("opening_stock") else None}
        warnings = [] if price is not None else [f"Price not set for {product['name']}. You can add it later in Update products."]
        draft = {"customer": None, "items": [], "total_paise": 0, "payment_mode": "cash", "paid_paise": 0,
                 "reverses_entry_id": None, "product": product, "changes": [], "warnings": warnings}
        spec = {"kind": "product", "name": product["name"], "unit": product["unit"], "selling_price_paise": price,
                "opening_stock": spec_in.get("opening_stock")}
        saved = self._save_draft("ADD_PRODUCT", draft, spec, tr, language)
        return response(tr, language, "ADD_PRODUCT", "draft", draft=saved, reply=T.product(product, language))

    def undo_draft(self, entry_id: str, language: str, transcript: str = "") -> dict:
        entry = self.store.entry(self.ctx.shop_id, entry_id)
        if entry is None:
            raise VoiceError(404, "ENTRY_NOT_FOUND", "That entry was not found.")
        if entry["type"] == "reversal" or entry["reversed"]:
            raise VoiceError(409, "ALREADY_REVERSED", "This entry was already undone.")
        customer = None
        if entry["customer_id"]:
            customer = next((c for c in self.store.customers(self.ctx.shop_id) if c.id == entry["customer_id"]), None)
        draft = {
            "customer": _ref(customer) if customer else None, "items": entry["items"], "total_paise": entry["amount_paise"],
            "payment_mode": entry["payment_mode"] or "cash", "paid_paise": entry["paid_paise"], "reverses_entry_id": entry["id"],
            "product": None, "changes": [], "warnings": [],
        }
        saved = self._save_draft("UNDO", draft, {"kind": "reversal", "entry_id": entry["id"]}, transcript, language)
        return response(transcript, language, "UNDO", "draft", draft=saved, reply=T.undo(entry["amount_paise"], language))

    # .................................................................. read-only answers
    def _answer(self, c: CustomerRec, intent: str, tone: str, tr: str, language: str) -> dict:
        ref = _ref(c)
        balance = self.store.balance(self.ctx.shop_id, c.id)
        if intent == "SHOW_BALANCE":
            history = self.store.history_rows(self.ctx.shop_id, c.id)
            answer = {"kind": "balance", "data": {"customer": ref, "balance_paise": balance,
                                                  "last_entry_at": _iso(history[-1]["created_at"]) if history else None}}
            return response(tr, language, intent, "answer", answer=answer, reply=T.balance(c.name, balance, language))
        if intent == "EXPLAIN_BALANCE":
            rows = self.store.explain_rows(self.ctx.shop_id, c.id)
            total = sum(r["due_delta_paise"] for r in rows)
            if total != balance:
                logger.error("Balance check failed for a customer (explain %s != balance %s)", total, balance)
                raise VoiceError(500, "INTERNAL", "The balance could not be verified. Please check the ledger.")
            entries = [{**r, "created_at": _iso(r["created_at"])} for r in rows]
            answer = {"kind": "explain", "data": {"customer": ref, "entries": entries, "total_paise": total, "balance_paise": balance}}
            return response(tr, language, intent, "answer", answer=answer,
                            reply=T.explain(c.name, [r["due_delta_paise"] for r in rows], total, language))
        if intent == "SHOW_HISTORY":
            running, entries = 0, []
            for r in self.store.history_rows(self.ctx.shop_id, c.id):
                running += r["due_delta_paise"]
                entries.append({**r, "created_at": _iso(r["created_at"]), "running_balance_paise": running})
            answer = {"kind": "history", "data": {"customer": ref, "entries": entries, "balance_paise": balance}}
            return response(tr, language, intent, "answer", answer=answer, reply=T.history(c.name, len(entries), balance, language))
        # SEND_REMINDER: a drafted message only; the shopkeeper sends it from WhatsApp.
        if balance <= 0:
            reply = {"hi": f"{c.name} ka kuch baaki nahi hai.", "kn": f"{c.name} avara baaki illa.", "en": f"Nothing is due from {c.name}."}[T.lang(language)]
            return error_response(tr, language, intent, "NOTHING_DUE", reply)
        shop = self.store.shop_name(self.ctx.shop_id)
        number = reminders.whatsapp_number(c.whatsapp, c.phone)

        def variant(t: str) -> dict:
            text = reminders.reminder_text(name=c.name, shop=shop, amount_text=T.rupees(balance), tone=t, language=language)
            return {"tone": t, "message_text": text, "whatsapp_url": reminders.whatsapp_url(number, text) if number else None}

        main_variant = variant(tone)
        answer = {"kind": "reminder", "data": {**main_variant, "customer": ref, "balance_paise": balance, "phone": number,
                                               "alternatives": [variant("firm" if tone == "soft" else "soft")]}}
        return response(tr, language, intent, "answer", answer=answer, reply=T.t("reminder_ready", language))

    # .................................................................. confirm / cancel
    def confirm(self, draft_id: str) -> dict:
        draft = self.store.get_draft(self.ctx, draft_id)
        if not draft:
            raise VoiceError(404, "DRAFT_NOT_FOUND", "That draft was not found.")
        if draft["status"] != "pending":
            raise VoiceError(409, "DRAFT_NOT_PENDING", "This draft is already saved or cancelled.")
        if draft["expires_at"] <= datetime.now(timezone.utc):
            self.store.set_draft_status(self.ctx, draft_id, "expired")
            raise VoiceError(410, "DRAFT_EXPIRED", "This draft expired. Nothing was saved. Please speak again.")
        payload = draft["payload"]
        spec, saved_draft, language = payload["exec"], payload["draft"], payload.get("language", "hi-IN")
        result = self.store.execute(self.ctx, draft_id, spec, draft["transcript"])
        if spec["kind"] == "product":
            product = {"id": result["product_id"], "name": spec["name"], "unit": spec.get("unit") or "pcs",
                       "selling_price_paise": spec.get("selling_price_paise"),
                       "stock_qty": float(Decimal(str(spec.get("opening_stock") or "0")))}
            return {"status": "saved", "intent": draft["intent"], "entry_id": None,
                    "reply_text": T.product_added(spec["name"], language),
                    "answer": {"kind": "product_added", "data": {"product": product}}}
        customer = saved_draft.get("customer")
        balance = self.store.balance(self.ctx.shop_id, customer["id"]) if customer else None
        return {"status": "saved", "intent": draft["intent"], "entry_id": result["entry_id"],
                "reply_text": T.saved(customer, balance, language), "answer": None}

    def cancel(self, draft_id: str) -> dict:
        draft = self.store.get_draft(self.ctx, draft_id)
        if not draft:
            raise VoiceError(404, "DRAFT_NOT_FOUND", "That draft was not found.")
        if draft["status"] == "pending":
            self.store.set_draft_status(self.ctx, draft_id, "cancelled")
        return {"status": "cancelled", "draft_id": draft_id}

    # .................................................................. speak / usage
    def speak(self, text: str, language: str) -> tuple[bytes, str]:
        text = (text or "").strip()
        if not text or len(text) > 500:
            raise VoiceError(400, "BAD_REQUEST", "Text must be 1 to 500 characters.")
        tts = providers.make_tts(self.settings)
        if tts.name == "mock":
            return tts.speak(text, language)
        key = (language, text)
        if len(text) <= 200 and (cached := TTS_CACHE.get(key)):
            return cached
        seconds = round(len(text) / 12, 2)  # estimate of speaking time, for the credit guard
        self._check_daily_limit(seconds)
        with gnani_slot(self.settings.lock_wait_seconds):
            try:
                audio = tts.speak(text, language)
            except VoiceError:
                self.store.log_usage(self.ctx, "speak", tts.name, seconds, len(text), False)
                raise
        self.store.log_usage(self.ctx, "speak", tts.name, seconds, len(text), True)
        if len(text) <= 200:
            TTS_CACHE.put(key, audio)
        return audio

    def usage(self) -> dict:
        used = self.store.gnani_usage_today()
        limit = self.settings.daily_limit_seconds
        return {
            "date": datetime.now(timezone.utc).astimezone().date().isoformat(),
            "seconds_used": round(used["seconds"], 1), "daily_limit_seconds": limit,
            "seconds_left": round(max(0.0, limit - used["seconds"]), 1),
            "calls_today": used["calls"], "tts_characters_today": used["characters"],
        }


def _items_json(items: list[ParsedItem]) -> list[dict]:
    return [{"product_id": i.product.id, "qty": str(i.qty), "note": i.note} for i in items]


def _detail(c: CustomerRec) -> str:
    """How to tell two customers with the same name apart, from DB facts only."""
    if c.locality:
        return c.locality
    if c.last_item and c.last_sale_at:
        first = c.last_item
        days =(datetime.now(timezone.utc) - (c.last_sale_at if c.last_sale_at.tzinfo else c.last_sale_at.replace(tzinfo=timezone.utc))).days
        when = "today" if days <= 0 else "yesterday" if days == 1 else f"{days} days ago"
        return f"{first}, {when}"
    return f"No locality, phone {c.phone[-4:]}" if c.phone else "No locality"
