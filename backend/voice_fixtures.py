"""Demo data for the voice tests (same customers, products and Ramesh's Rs 840 as supabase/seed.sql)
and an in-memory VoiceStore. Test-only: no database, no network."""
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from voice.parser import CustomerRec, ProductRec
from voice.providers import VoiceError
from voice.store import Ctx

NOW = datetime.now(timezone.utc)


def demo_customers() -> list[CustomerRec]:
    return [
        CustomerRec("ravi-gn", "Ravi", [], "Gandhi Nagar", "9845012345", "9845012345", 18000),
        CustomerRec("ravi-2", "Ravi", [], None, "9900112233", "9900112233", 36400, "Sona Masoori Rice", NOW - timedelta(days=1, hours=5)),
        CustomerRec("ramesh", "Ramesh", ["ramesh anna"], "Seshadripuram", "9886054321", "9886054321", 84000),
        CustomerRec("lakshmi", "Lakshmi", ["lakshmi akka"], "Malleshwaram", "9741122334", "9741122334", 0),
        CustomerRec("suresh", "Suresh", [], "Majestic", "9844455667", "9844455667", 77000),
        CustomerRec("kiran", "Kiran", [], "Rajajinagar", None, None, 0),
    ]


def demo_products() -> list[ProductRec]:
    D = Decimal
    return [
        ProductRec("milk", "Nandini Toned Milk 500ml", ["milk", "doodh", "haalu", "nandini"], "packet", 2700, D("28")),
        ProductRec("rice", "Sona Masoori Rice", ["rice", "chawal", "akki", "sona masoori"], "kg", 6200, D("90")),
        ProductRec("salt", "Tata Salt 1kg", ["salt", "namak", "uppu", "tata namak"], "packet", 2800, D("37")),
        ProductRec("oil", "Fortune Sunflower Oil 1L", ["oil", "tel", "enne", "fortune tel", "sunflower oil"], "packet", 16500, D("23")),
        ProductRec("bread", "Modern Bread 400g", ["bread", "pav", "double roti"], "packet", 4500, D("11")),
        ProductRec("sugar", "Sugar", ["sugar", "cheeni", "shakkar", "sakkare"], "kg", 4600, D("67")),
        ProductRec("atta", "Aashirvaad Atta 5kg", ["atta", "gehun atta", "godhi hittu", "aashirvaad"], "packet", 28500, D("17")),
        ProductRec("toor", "Toor Dal", ["dal", "toor dal", "arhar dal", "togari bele"], "kg", 16000, D("35.5")),
        ProductRec("eggs", "Eggs", ["egg", "eggs", "anda", "motte"], "piece", 700, D("144")),
        ProductRec("curd", "Nandini Curd 500g", ["curd", "dahi", "mosaru"], "packet", 3000, D("17")),
        ProductRec("tomato", "Tomato", ["tomato", "tamatar"], "kg", 3000, D("3")),
        ProductRec("onion", "Onion", ["onion", "pyaz", "eerulli"], "kg", 4000, D("45.5")),
    ]


class FakeStore:
    """In-memory VoiceStore. `execute` mimics the ledger rules (append-only, payment <= due)."""

    def __init__(self, shop_id: str = "shop-a"):
        self.shop_id = shop_id
        self._customers = demo_customers()
        self._products = demo_products()
        self.drafts: dict[str, dict] = {}
        self.writes: list[dict] = []  # everything that reached the "ledger"
        self.usage: list[dict] = []
        self.entries: list[dict] = [
            {"id": "e-ramesh-1", "customer_id": "ramesh", "type": "sale", "amount_paise": 56200, "paid_paise": 0, "payment_mode": "udhaar",
             "due_delta_paise": 56200, "created_at": NOW - timedelta(days=9), "description": "Sona Masoori Rice 5 kg, Toor Dal 1 kg, Sugar 2 kg",
             "created_by": "seed-owner", "items": []},
            {"id": "e-ramesh-2", "customer_id": "ramesh", "type": "sale", "amount_paise": 47800, "paid_paise": 0, "payment_mode": "udhaar",
             "due_delta_paise": 47800, "created_at": NOW - timedelta(days=4), "description": "Fortune Sunflower Oil 1L 1 packet, Tata Salt 1kg 1 packet, Aashirvaad Atta 5kg 1 packet",
             "created_by": "seed-owner", "items": []},
            {"id": "e-ramesh-3", "customer_id": "ramesh", "type": "payment", "amount_paise": 20000, "paid_paise": 20000, "payment_mode": "upi",
             "due_delta_paise": -20000, "created_at": NOW - timedelta(days=2), "description": "UPI payment", "created_by": "seed-owner", "items": []},
        ]

    def _check(self, shop_id: str):
        if shop_id != self.shop_id:
            return False
        return True

    # reads
    def customers(self, shop_id):
        return list(self._customers) if self._check(shop_id) else []

    def products(self, shop_id):
        return list(self._products) if self._check(shop_id) else []

    def shop_name(self, shop_id):
        return "Sri Lakshmi Kirana Stores"

    def balance(self, shop_id, customer_id):
        if not self._check(shop_id):
            return 0
        base = next((c.balance_paise for c in self._customers if c.id == customer_id), 0)
        if customer_id == "ramesh":
            base = 0
        return base + sum(e["due_delta_paise"] for e in self.entries if e["customer_id"] == customer_id)

    def explain_rows(self, shop_id, customer_id):
        return [
            {k: e[k] for k in ("created_at", "type", "description", "due_delta_paise")} | {"entry_id": e["id"]}
            for e in self.entries if e["customer_id"] == customer_id and e["due_delta_paise"] != 0
        ] if self._check(shop_id) else []

    def history_rows(self, shop_id, customer_id):
        return [
            {k: e[k] for k in ("created_at", "type", "description", "amount_paise", "due_delta_paise")} | {"entry_id": e["id"]}
            for e in self.entries if e["customer_id"] == customer_id
        ] if self._check(shop_id) else []

    def entry(self, shop_id, entry_id):
        e = next((x for x in self.entries if x["id"] == entry_id), None) if self._check(shop_id) else None
        if e is None:
            return None
        reversed_ = any(x["type"] == "reversal" and x.get("ref") == entry_id for x in self.entries)
        return {**{k: e[k] for k in ("id", "type", "customer_id", "amount_paise", "paid_paise", "payment_mode", "items")}, "reversed": reversed_}

    def last_undoable_entry(self, shop_id, user_id):
        for e in reversed(self.entries):
            if e["type"] in ("sale", "payment") and e.get("created_by") == user_id and not any(
                x["type"] == "reversal" and x.get("ref") == e["id"] for x in self.entries
            ):
                return e["id"]
        return None

    # drafts
    def create_draft(self, ctx: Ctx, intent, payload, transcript, minutes):
        draft_id = str(uuid.uuid4())
        expires = datetime.now(timezone.utc) + timedelta(minutes=minutes)
        self.drafts[draft_id] = {"id": draft_id, "ctx": ctx, "intent": intent, "payload": payload, "status": "pending",
                                 "expires_at": expires, "transcript": transcript}
        return draft_id, expires

    def get_draft(self, ctx: Ctx, draft_id) -> Optional[dict]:
        d = self.drafts.get(draft_id)
        if not d or d["ctx"] != ctx:
            return None
        return {k: d[k] for k in ("id", "intent", "payload", "status", "expires_at", "transcript")}

    def update_draft(self, ctx: Ctx, draft_id, intent, payload, minutes):
        d = self.drafts[draft_id]
        if d["status"] != "pending":
            raise VoiceError(409, "DRAFT_NOT_PENDING", "This draft is already saved or cancelled.")
        d.update(intent=intent, payload=payload, expires_at=datetime.now(timezone.utc) + timedelta(minutes=minutes))
        return d["expires_at"]

    def set_draft_status(self, ctx: Ctx, draft_id, status):
        d = self.drafts.get(draft_id)
        if d and d["ctx"] == ctx and d["status"] == "pending":
            d["status"] = status

    def execute(self, ctx: Ctx, draft_id, spec, transcript):
        d = self.drafts[draft_id]
        if d["status"] != "pending":
            raise VoiceError(409, "DRAFT_NOT_PENDING", "This draft is already saved or cancelled.")
        entry_id = str(uuid.uuid4())
        kind = spec["kind"]
        if kind == "payment":
            due = self.balance(ctx.shop_id, spec["customer_id"])
            if spec["amount_paise"] > due:
                raise VoiceError(422, "PAYMENT_MORE_THAN_DUE", f"Payment is more than the due amount (₹{due // 100}).")
            self.entries.append({"id": entry_id, "customer_id": spec["customer_id"], "type": "payment", "amount_paise": spec["amount_paise"],
                                 "paid_paise": spec["amount_paise"], "payment_mode": spec["method"], "due_delta_paise": -spec["amount_paise"],
                                 "created_at": datetime.now(timezone.utc), "description": "payment", "created_by": ctx.user_id, "items": []})
        elif kind == "sale":
            total = sum(d["payload"]["draft"]["items"][i]["line_total_paise"] or 0 for i in range(len(spec["items"])))
            due = total if spec["method"] == "udhaar" else 0
            self.entries.append({"id": entry_id, "customer_id": spec["customer_id"], "type": "sale", "amount_paise": total,
                                 "paid_paise": total - due, "payment_mode": spec["method"], "due_delta_paise": due if spec["customer_id"] else 0,
                                 "created_at": datetime.now(timezone.utc), "description": "sale", "created_by": ctx.user_id,
                                 "items": d["payload"]["draft"]["items"]})
        elif kind == "reversal":
            original = next(e for e in self.entries if e["id"] == spec["entry_id"])
            if any(x["type"] == "reversal" and x.get("ref") == original["id"] for x in self.entries):
                raise VoiceError(409, "ALREADY_REVERSED", "This entry was already undone.")
            self.entries.append({"id": entry_id, "customer_id": original["customer_id"], "type": "reversal", "ref": original["id"],
                                 "amount_paise": original["amount_paise"], "paid_paise": original["paid_paise"],
                                 "payment_mode": original["payment_mode"], "due_delta_paise": -original["due_delta_paise"],
                                 "created_at": datetime.now(timezone.utc), "description": "reversal", "created_by": ctx.user_id, "items": []})
        elif kind == "product":
            entry_id = None
        self.writes.append({"kind": kind, "draft_id": draft_id, **spec})
        d["status"] = "confirmed"
        return {"entry_id": entry_id, "product_id": "new-product" if kind == "product" else None}

    # usage
    def gnani_usage_today(self):
        return {"seconds": sum(u["seconds"] for u in self.usage), "calls": len(self.usage), "characters": sum(u["characters"] for u in self.usage)}

    def log_usage(self, ctx, endpoint, provider, audio_seconds, characters, success):
        self.usage.append({"shop_id": ctx.shop_id, "user_id": ctx.user_id, "endpoint": endpoint, "provider": provider,
                           "seconds": audio_seconds, "characters": characters, "success": success})
