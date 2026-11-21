"""Database access for the voice assistant. Every query is filtered by the caller's shop_id (and,
for drafts, by the user). Writes to the ledger go through the SAME helpers as the normal endpoints
(injected from main.py as `ledger`), inside one transaction.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable, Optional, Protocol

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .parser import CustomerRec, ProductRec
from .providers import VoiceError


@dataclass(frozen=True)
class Ctx:
    """Who is asking (from the verified Supabase token)."""

    user_id: str
    shop_id: str


@dataclass
class Ledger:
    """The shared write helpers from main.py (same code as POST /transactions, /payments, ...)."""

    record_sale: Callable[..., tuple[str, int, int]]
    record_payment: Callable[..., dict]
    record_reversal: Callable[..., str]
    record_product: Callable[..., str]
    set_actor: Callable[[Session, str], None]


class VoiceStore(Protocol):
    def customers(self, shop_id: str) -> list[CustomerRec]: ...
    def products(self, shop_id: str) -> list[ProductRec]: ...
    def shop_name(self, shop_id: str) -> str: ...
    def balance(self, shop_id: str, customer_id: str) -> int: ...
    def explain_rows(self, shop_id: str, customer_id: str) -> list[dict]: ...
    def history_rows(self, shop_id: str, customer_id: str) -> list[dict]: ...
    def entry(self, shop_id: str, entry_id: str) -> Optional[dict]: ...
    def last_undoable_entry(self, shop_id: str, user_id: str) -> Optional[str]: ...
    def create_draft(self, ctx: Ctx, intent: str, payload: dict, transcript: str, minutes: int) -> tuple[str, datetime]: ...
    def get_draft(self, ctx: Ctx, draft_id: str) -> Optional[dict]: ...
    def update_draft(self, ctx: Ctx, draft_id: str, intent: str, payload: dict, minutes: int) -> datetime: ...
    def set_draft_status(self, ctx: Ctx, draft_id: str, status: str) -> None: ...
    def execute(self, ctx: Ctx, draft_id: str, spec: dict, transcript: str) -> dict: ...
    def gnani_usage_today(self) -> dict: ...
    def log_usage(self, ctx: Ctx, endpoint: str, provider: str, audio_seconds: float, characters: int, success: bool) -> None: ...


def _uuid_ok(value: str) -> bool:
    import uuid

    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


class PostgresStore:
    def __init__(self, db: Session, ledger: Ledger):
        self.db = db
        self.ledger = ledger

    # ------------------------------------------------------------------ reads
    def _all(self, sql: str, values: dict) -> list[Any]:
        return self.db.execute(text(sql), values).mappings().all()

    def _one(self, sql: str, values: dict):
        return self.db.execute(text(sql), values).mappings().first()

    def customers(self, shop_id: str) -> list[CustomerRec]:
        rows = self._all(
            """
            select c.id, c.name, c.aliases, c.locality, c.phone, c.whatsapp,
                   coalesce(b.balance_paise, 0) as balance_paise, last.item, last.created_at as last_sale_at
              from public.customers c
              left join public.customer_balances b on b.shop_id = c.shop_id and b.customer_id = c.id
              left join lateral (
                    select i.product_name_snapshot as item, e.created_at
                      from public.ledger_entries e
                      join public.ledger_items i on i.shop_id = e.shop_id and i.entry_id = e.id
                     where e.shop_id = c.shop_id and e.customer_id = c.id and e.type = 'sale'
                       and not exists (select 1 from public.ledger_entries r
                                        where r.shop_id = e.shop_id and r.ref_entry_id = e.id and r.type = 'reversal')
                     order by e.created_at desc, i.created_at
                     limit 1
                   ) last on true
             where c.shop_id = :shop_id and c.archived_at is null
            """,
            {"shop_id": shop_id},
        )
        return [
            CustomerRec(
                id=str(r["id"]), name=r["name"], aliases=list(r["aliases"] or []), locality=r["locality"],
                phone=r["phone"], whatsapp=r["whatsapp"], balance_paise=int(r["balance_paise"]),
                last_item=r["item"], last_sale_at=r["last_sale_at"],
            )
            for r in rows
        ]

    def products(self, shop_id: str) -> list[ProductRec]:
        rows = self._all(
            """
            select id, name, aliases, unit, selling_price_paise, stock_qty
              from public.products
             where shop_id = :shop_id and archived_at is null
            """,
            {"shop_id": shop_id},
        )
        return [
            ProductRec(
                id=str(r["id"]), name=r["name"], aliases=list(r["aliases"] or []), unit=r["unit"],
                price_paise=r["selling_price_paise"], stock=Decimal(str(r["stock_qty"])),
            )
            for r in rows
        ]

    def shop_name(self, shop_id: str) -> str:
        row = self._one("select shop_name from public.shops where id = :shop_id", {"shop_id": shop_id})
        return (row or {}).get("shop_name") or ""

    def balance(self, shop_id: str, customer_id: str) -> int:
        row = self._one(
            "select balance_paise from public.customer_balances where shop_id = :shop_id and customer_id = :customer_id",
            {"shop_id": shop_id, "customer_id": customer_id},
        )
        return int(row["balance_paise"]) if row else 0

    def explain_rows(self, shop_id: str, customer_id: str) -> list[dict]:
        rows = self._all(
            "select * from public.explain_customer_balance(:shop_id, :customer_id)",
            {"shop_id": shop_id, "customer_id": customer_id},
        )
        return [
            {
                "entry_id": str(r["entry_id"]), "created_at": r["created_at"], "type": r["type"],
                "description": r["items_summary"] or r["note"] or _type_label(r["type"], r["payment_mode"]),
                "due_delta_paise": int(r["due_delta_paise"]),
            }
            for r in rows
        ]

    def history_rows(self, shop_id: str, customer_id: str) -> list[dict]:
        rows = self._all(
            """
            select e.id, e.created_at, e.type, e.payment_mode, e.amount_paise, e.due_delta_paise, e.note,
                   (select string_agg(i.product_name_snapshot || ' ' || rtrim(rtrim(i.qty::text, '0'), '.') || ' ' || i.unit, ', '
                                      order by i.created_at, i.id)
                      from public.ledger_items i where i.shop_id = e.shop_id and i.entry_id = e.id) as items
              from public.ledger_entries e
             where e.shop_id = :shop_id and e.customer_id = :customer_id
             order by e.created_at, e.id
            """,
            {"shop_id": shop_id, "customer_id": customer_id},
        )
        return [
            {
                "entry_id": str(r["id"]), "created_at": r["created_at"], "type": r["type"],
                "description": r["items"] or r["note"] or _type_label(r["type"], r["payment_mode"]),
                "amount_paise": int(r["amount_paise"]), "due_delta_paise": int(r["due_delta_paise"]),
            }
            for r in rows
        ]

    def entry(self, shop_id: str, entry_id: str) -> Optional[dict]:
        if not _uuid_ok(entry_id):
            return None
        row = self._one(
            """
            select e.id, e.type, e.customer_id, e.amount_paise, e.paid_paise, e.payment_mode,
                   exists (select 1 from public.ledger_entries r
                            where r.shop_id = e.shop_id and r.ref_entry_id = e.id and r.type = 'reversal') as reversed
              from public.ledger_entries e
             where e.shop_id = :shop_id and e.id = :entry_id
            """,
            {"shop_id": shop_id, "entry_id": entry_id},
        )
        if row is None:
            return None
        items = self._all(
            """
            select product_id, product_name_snapshot as name, qty, unit, unit_price_paise, line_total_paise
              from public.ledger_items where shop_id = :shop_id and entry_id = :entry_id
             order by created_at, id
            """,
            {"shop_id": shop_id, "entry_id": entry_id},
        )
        return {
            "id": str(row["id"]), "type": row["type"], "customer_id": str(row["customer_id"]) if row["customer_id"] else None,
            "amount_paise": int(row["amount_paise"]), "paid_paise": int(row["paid_paise"]),
            "payment_mode": row["payment_mode"], "reversed": bool(row["reversed"]),
            "items": [
                {
                    "product_id": str(i["product_id"]) if i["product_id"] else None, "name": i["name"],
                    "qty": float(i["qty"]), "unit": i["unit"], "unit_price_paise": int(i["unit_price_paise"]),
                    "line_total_paise": int(i["line_total_paise"]), "conversion_note": None,
                }
                for i in items
            ],
        }

    def last_undoable_entry(self, shop_id: str, user_id: str) -> Optional[str]:
        row = self._one(
            """
            select e.id from public.ledger_entries e
             where e.shop_id = :shop_id and e.created_by = :user_id and e.type in ('sale', 'payment')
               and not exists (select 1 from public.ledger_entries r
                                where r.shop_id = e.shop_id and r.ref_entry_id = e.id and r.type = 'reversal')
             order by e.created_at desc, e.id desc
             limit 1
            """,
            {"shop_id": shop_id, "user_id": user_id},
        )
        return str(row["id"]) if row else None

    # ------------------------------------------------------------------ drafts (assistant_drafts)
    def create_draft(self, ctx: Ctx, intent: str, payload: dict, transcript: str, minutes: int) -> tuple[str, datetime]:
        import json

        self.ledger.set_actor(self.db, ctx.user_id)
        row = self.db.execute(
            text(
                """
                insert into public.assistant_drafts (shop_id, user_id, intent, action_json, transcript, expires_at)
                values (:shop_id, :user_id, :intent, cast(:payload as jsonb), :transcript, now() + make_interval(mins => :minutes))
                returning id, expires_at
                """
            ),
            {"shop_id": ctx.shop_id, "user_id": ctx.user_id, "intent": intent, "payload": json.dumps(payload),
             "transcript": transcript[:2000] or None, "minutes": minutes},
        ).mappings().one()
        self.db.commit()
        return str(row["id"]), row["expires_at"]

    def get_draft(self, ctx: Ctx, draft_id: str) -> Optional[dict]:
        if not _uuid_ok(draft_id):
            return None
        row = self._one(
            """
            select id, intent, action_json, status, expires_at, transcript
              from public.assistant_drafts
             where id = :draft_id and shop_id = :shop_id and user_id = :user_id
            """,
            {"draft_id": draft_id, "shop_id": ctx.shop_id, "user_id": ctx.user_id},
        )
        if row is None:
            return None
        return {"id": str(row["id"]), "intent": row["intent"], "payload": row["action_json"], "status": row["status"],
                "expires_at": row["expires_at"], "transcript": row["transcript"] or ""}

    def update_draft(self, ctx: Ctx, draft_id: str, intent: str, payload: dict, minutes: int) -> datetime:
        import json

        self.ledger.set_actor(self.db, ctx.user_id)
        row = self.db.execute(
            text(
                """
                update public.assistant_drafts
                   set intent = :intent, action_json = cast(:payload as jsonb), expires_at = now() + make_interval(mins => :minutes)
                 where id = :draft_id and shop_id = :shop_id and user_id = :user_id and status = 'pending'
                returning expires_at
                """
            ),
            {"intent": intent, "payload": json.dumps(payload), "minutes": minutes, "draft_id": draft_id,
             "shop_id": ctx.shop_id, "user_id": ctx.user_id},
        ).mappings().first()
        if row is None:
            self.db.rollback()
            raise VoiceError(409, "DRAFT_NOT_PENDING", "This draft is already saved or cancelled.")
        self.db.commit()
        return row["expires_at"]

    def set_draft_status(self, ctx: Ctx, draft_id: str, status: str) -> None:
        self.ledger.set_actor(self.db, ctx.user_id)
        self.db.execute(
            text(
                """
                update public.assistant_drafts set status = :status
                 where id = :draft_id and shop_id = :shop_id and user_id = :user_id and status = 'pending'
                """
            ),
            {"status": status, "draft_id": draft_id, "shop_id": ctx.shop_id, "user_id": ctx.user_id},
        )
        self.db.commit()

    # ------------------------------------------------------------------ confirm: one transaction
    def execute(self, ctx: Ctx, draft_id: str, spec: dict, transcript: str) -> dict:
        kind = spec["kind"]
        db, ledger = self.db, self.ledger
        result: dict = {"entry_id": None, "product_id": None}
        try:
            if kind == "sale":
                entry_id, _, _ = ledger.record_sale(
                    db, ctx,
                    customer_id=spec.get("customer_id"),
                    items=[(pid, Decimal(str(q))) for pid, q in spec["items"]],
                    method=spec["method"],
                    source="voice",
                    transcript=transcript,
                )
                result["entry_id"] = entry_id
            elif kind == "payment":
                entry = ledger.record_payment(db, ctx, spec["customer_id"], int(spec["amount_paise"]), spec["method"], None,
                                              source="voice", transcript=transcript)
                result["entry_id"] = entry["id"]
            elif kind == "reversal":
                result["entry_id"] = ledger.record_reversal(db, ctx, spec["entry_id"], source="voice")
            elif kind == "product":
                result["product_id"] = ledger.record_product(
                    db, ctx, name=spec["name"], selling_price_paise=spec.get("selling_price_paise"),
                    unit=spec.get("unit") or "pcs", stock_qty=Decimal(str(spec.get("opening_stock") or "0")),
                )
            else:
                raise VoiceError(400, "BAD_REQUEST", "Unknown draft.")
            ledger.set_actor(db, ctx.user_id)
            done = db.execute(
                text(
                    """
                    update public.assistant_drafts
                       set status = 'confirmed', confirmed_at = now(), result_entry_id = :entry_id
                     where id = :draft_id and shop_id = :shop_id and user_id = :user_id and status = 'pending'
                    """
                ),
                {"entry_id": result["entry_id"], "draft_id": draft_id, "shop_id": ctx.shop_id, "user_id": ctx.user_id},
            )
            if done.rowcount != 1:
                raise VoiceError(409, "DRAFT_NOT_PENDING", "This draft is already saved or cancelled.")
            db.commit()
        except HTTPException as error:
            db.rollback()
            raise _from_http(error, kind) from error
        except IntegrityError as error:
            db.rollback()
            if kind == "reversal":
                raise VoiceError(409, "ALREADY_REVERSED", "This entry was already undone.") from error
            if kind == "product":
                raise VoiceError(409, "BAD_REQUEST", "A product with this name already exists.") from error
            raise VoiceError(409, "OUT_OF_STOCK", "Not enough stock for this bill.") from error
        except VoiceError:
            db.rollback()
            raise
        return result

    # ------------------------------------------------------------------ Gnani usage (credit guard)
    def gnani_usage_today(self) -> dict:
        row = self._one(
            """
            select coalesce(sum(audio_seconds), 0) as seconds, count(*) as calls, coalesce(sum(characters), 0) as characters
              from public.voice_usage
             where provider = 'gnani'
               and created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
            """,
            {},
        )
        return {"seconds": float(row["seconds"]), "calls": int(row["calls"]), "characters": int(row["characters"])}

    def log_usage(self, ctx: Ctx, endpoint: str, provider: str, audio_seconds: float, characters: int, success: bool) -> None:
        self.db.execute(
            text(
                """
                insert into public.voice_usage (shop_id, user_id, endpoint, provider, audio_seconds, characters, success)
                values (:shop_id, :user_id, :endpoint, :provider, :seconds, :characters, :success)
                """
            ),
            {"shop_id": ctx.shop_id, "user_id": ctx.user_id, "endpoint": endpoint, "provider": provider,
             "seconds": round(audio_seconds, 2), "characters": characters, "success": success},
        )
        self.db.commit()


def _type_label(entry_type: str, mode: Optional[str]) -> str:
    if entry_type == "payment":
        return "UPI payment" if mode == "upi" else "Cash payment"
    return {"opening_balance": "Opening balance", "reversal": "Reversal", "correction": "Correction"}.get(entry_type, "Sale")


def _from_http(error: HTTPException, kind: str) -> VoiceError:
    """Shared helpers raise HTTPException; turn them into the contract's error codes."""
    detail = str(error.detail)
    if error.status_code == 422 and detail.startswith("Payment is more than the due amount"):
        return VoiceError(422, "PAYMENT_MORE_THAN_DUE", detail)
    if error.status_code == 404:
        return VoiceError(404, "ENTRY_NOT_FOUND" if kind == "reversal" else "CUSTOMER_NOT_FOUND" if kind == "payment" else "PRODUCT_NOT_FOUND", detail)
    if error.status_code == 409 and kind == "reversal":
        return VoiceError(409, "ALREADY_REVERSED", detail)
    return VoiceError(error.status_code if error.status_code < 500 else 500, "BAD_REQUEST" if error.status_code < 500 else "INTERNAL", detail)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def expires_in(minutes: int) -> datetime:
    return utcnow() + timedelta(minutes=minutes)
