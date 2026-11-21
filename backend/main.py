import base64
import binascii
import json
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from database import get_db
from schemas import (
    CustomerCreate,
    CustomerUpdate,
    OtpSendInput,
    OtpVerifyInput,
    PaymentCreate,
    ProductCreate,
    ProductUpdate,
    ProfileInput,
    TransactionCreate,
    VoiceCommandInput,
)
from supabase_client import (
    SupabaseNotConfigured,
    SupabaseRequestError,
    create_auth_user,
    create_signed_storage_url,
    delete_auth_user,
    delete_storage_objects,
    refresh_auth_session,
    sign_in_with_password,
    sign_out,
    upload_storage_object,
    verify_access_token,
)

logger = logging.getLogger(__name__)


def _cors_origins() -> list[str]:
    """Allowed browser origins, from CORS_ORIGINS (comma-separated). Defaults to the Vite dev server."""
    raw = os.environ.get("CORS_ORIGINS", "").strip()
    if not raw:
        return ["http://localhost:5173", "http://127.0.0.1:5173"]
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


app = FastAPI(title="Khatha Sathi API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Error-Field"],
)

OTP_MODE = os.environ.get("OTP_MODE", "").strip().lower()
DEV_OTP_CODE = os.environ.get("DEV_OTP_CODE", "").strip()
MAX_REPORT_ATTACHMENT_BYTES = 8 * 1024 * 1024
MAX_REPORT_ATTACHMENTS = 2
MAX_AVATAR_BYTES = 2 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
}
AVATAR_TYPES = {"image/jpeg", "image/png", "image/webp"}
_sent_otps: dict[str, str] = {}
_verified_phones: set[str] = set()

# OTP rate limits (in memory, per phone number). Dev OTP has no SMS cost, but a real
# provider will, and guessing must stay slow either way.
OTP_RESEND_SECONDS = 30  # matches the Sign up page's resend countdown
OTP_SENDS_PER_HOUR = 5
OTP_FAILED_VERIFY_LIMIT = 5
OTP_FAILED_VERIFY_WINDOW = 10 * 60
BALANCE_EDIT_REFUSED = (
    "A customer's balance can only change through bills, payments or undo. "
    "The opening balance can be entered only when the customer is added."
)
_otp_sends: dict[str, list[float]] = {}
_otp_failures: dict[str, list[float]] = {}


def _recent(events: dict[str, list[float]], key: str, window: float, now: float) -> list[float]:
    kept = [t for t in events.get(key, []) if now - t < window]
    events[key] = kept
    return kept


def _too_many(message: str, retry_after: float) -> HTTPException:
    seconds = max(1, int(retry_after + 0.999))
    return HTTPException(
        status_code=429,
        detail=f"{message} Try again in {seconds} seconds.",
        headers={"Retry-After": str(seconds), "X-Error-Field": "otp"},
    )


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    shop_id: str
    email: str


class LoginInput(BaseModel):
    method: str
    identifier: str
    password: str


class SignupInput(BaseModel):
    email: str
    name: str
    phone: str
    password: str
    city: str
    businessDomain: str
    otp: Optional[str] = None


class RefreshInput(BaseModel):
    refreshToken: str


@app.exception_handler(SupabaseNotConfigured)
async def supabase_not_configured_handler(_, error: SupabaseNotConfigured):
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=503, content={"detail": str(error)})


@app.exception_handler(SupabaseRequestError)
async def supabase_request_error_handler(_, error: SupabaseRequestError):
    from fastapi.responses import JSONResponse

    logger.error("Supabase request failed: %s", error)
    return JSONResponse(
        status_code=502,
        content={"detail": "Supabase request failed; check the backend logs."},
    )


@app.exception_handler(SQLAlchemyError)
async def database_error_handler(_, error: SQLAlchemyError):
    logger.exception("Supabase database operation failed", exc_info=error)
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=503,
        content={"detail": "Database operation failed; check the backend logs."},
    )


def _one(db: Session, statement: str, values: dict):
    return db.execute(text(statement), values).mappings().first()


def _all(db: Session, statement: str, values: dict):
    return db.execute(text(statement), values).mappings().all()


def _set_actor(db: Session, user_id: str) -> None:
    db.execute(
        text("select set_config('app.user_id', :user_id, true)"),
        {"user_id": user_id},
    )


def _to_uuid(value: str, label: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as error:
        raise HTTPException(status_code=422, detail=f"{label} must be a UUID.") from error


def _decimal(value, label: str, *, default: Decimal | None = None) -> Decimal:
    if value is None or value == "":
        if default is not None:
            return default
        raise HTTPException(status_code=422, detail=f"{label} is required.")
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as error:
        raise HTTPException(status_code=422, detail=f"{label} must be numeric.") from error
    if not result.is_finite():
        raise HTTPException(status_code=422, detail=f"{label} must be finite.")
    return result


def _paise(value, label: str, *, default: Decimal | None = None) -> int:
    amount = _decimal(value, label, default=default)
    if amount < 0:
        raise HTTPException(status_code=422, detail=f"{label} cannot be negative.")
    return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _rupees(paise_value) -> float | None:
    if paise_value is None:
        return None
    return float((Decimal(str(paise_value)) / 100).quantize(Decimal("0.01")))


def _quantity(value, label: str = "quantity") -> Decimal:
    quantity = _decimal(value, label)
    if quantity <= 0:
        raise HTTPException(status_code=422, detail=f"{label} must be greater than zero.")
    rounded = quantity.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    if rounded != quantity:
        raise HTTPException(status_code=422, detail=f"{label} supports at most three decimal places.")
    return rounded


def _nonnegative_quantity(value, label: str) -> Decimal:
    quantity = _decimal(value, label)
    if quantity < 0:
        raise HTTPException(status_code=422, detail=f"{label} cannot be negative.")
    rounded = quantity.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    if rounded != quantity:
        raise HTTPException(status_code=422, detail=f"{label} supports at most three decimal places.")
    return rounded


def _normalize_phone(value: str, *, required: bool = True) -> str | None:
    digits = "".join(character for character in value if "0" <= character <= "9")
    if not digits and not required:
        return None
    if len(digits) > 10:
        digits = digits[-10:]
    if len(digits) != 10:
        raise HTTPException(status_code=422, detail="Enter a valid 10-digit phone number.")
    return digits


def _iso(value) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else value


def _auth_session(auth: dict, user: dict) -> dict:
    access_token = auth.get("access_token")
    refresh_token = auth.get("refresh_token")
    if not access_token or not refresh_token:
        raise SupabaseRequestError(502, "Supabase Auth returned an incomplete session.")
    return {
        "token": access_token,
        "refreshToken": refresh_token,
        "expiresAt": auth.get("expires_at"),
        "user": user,
    }


def _public_user(db: Session, user_id: str) -> dict:
    row = _one(
        db,
        """
        select p.user_id, p.email, p.phone, p.owner_name, p.avatar_path,
               p.primary_language, p.secondary_language,
               s.id as shop_id, s.shop_name, s.city, s.business_domain,
               s.address, s.gst_number, s.fssai_number,
               us.spoken_replies, us.voice_speed, us.voice_volume,
               us.daily_ledger_pdf, us.low_stock_alert, us.payment_reminder
          from public.profiles p
          join public.shops s on s.id = p.shop_id
          join public.user_settings us on us.user_id = p.user_id
         where p.user_id = :user_id
        """,
        {"user_id": user_id},
    )
    if row is None:
        raise HTTPException(status_code=401, detail="Account profile is not available.")

    avatar_url = ""
    if row["avatar_path"]:
        avatar_url = create_signed_storage_url("avatars", row["avatar_path"])
    return {
        "id": str(row["user_id"]),
        "name": row["owner_name"],
        "email": row["email"],
        "phone": row["phone"],
        "city": row["city"] or "",
        "businessDomain": row["business_domain"] or "",
        "shopName": row["shop_name"] or "",
        "gstNumber": row["gst_number"] or "",
        "fssaiNumber": row["fssai_number"] or "",
        "address": row["address"] or "",
        "avatarUrl": avatar_url,
        "primaryLanguage": row["primary_language"] or "",
        "secondaryLanguage": row["secondary_language"] or "",
        "spokenReplies": row["spoken_replies"],
        "voiceSpeed": row["voice_speed"],
        "voiceVolume": row["voice_volume"],
        "dailyLedgerPdf": row["daily_ledger_pdf"],
        "lowStockAlert": row["low_stock_alert"],
        "paymentReminder": row["payment_reminder"],
    }


def current_auth_context(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> AuthContext:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not logged in.")
    try:
        claims = verify_access_token(authorization.split(" ", 1)[1])
    except SupabaseRequestError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error

    user_id = claims.get("sub")
    if not isinstance(user_id, str):
        raise HTTPException(status_code=401, detail="Invalid Supabase access token.")
    row = _one(
        db,
        "select user_id, shop_id, email from public.profiles where user_id = :user_id",
        {"user_id": user_id},
    )
    if row is None:
        raise HTTPException(status_code=403, detail="No shop profile is linked to this account.")
    return AuthContext(
        user_id=str(row["user_id"]),
        shop_id=str(row["shop_id"]),
        email=row["email"],
    )


def _get_otp_code() -> str:
    if OTP_MODE != "dev":
        raise HTTPException(
            status_code=503,
            detail="Phone OTP is unavailable until a production provider is configured.",
        )
    if not re.fullmatch(r"\d{6}", DEV_OTP_CODE):
        raise HTTPException(
            status_code=503,
            detail="Set a six-digit DEV_OTP_CODE in backend/.env for local development.",
        )
    return DEV_OTP_CODE


def _cleanup_auth_user(user_id: str) -> None:
    try:
        delete_auth_user(user_id)
    except (SupabaseNotConfigured, SupabaseRequestError) as error:
        logger.exception("Could not remove Supabase Auth user after failed signup")
        raise HTTPException(
            status_code=502,
            detail="Account setup failed and the unprovisioned Auth user could not be removed.",
        ) from error


@app.get("/")
def root():
    return {"message": "Khatha Sathi API is running"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/health/ready")
def readiness(db: Session = Depends(get_db)):
    db.execute(text("select 1"))
    return {"status": "ready", "database": "connected"}


@app.post("/auth/otp/send")
def send_otp(body: OtpSendInput):
    payload = body.model_dump()
    phone = _normalize_phone(str(payload.get("phone", "")))
    code = _get_otp_code()
    now = time.monotonic()
    sends = _recent(_otp_sends, phone, 3600, now)
    if sends and now - sends[-1] < OTP_RESEND_SECONDS:
        raise _too_many("Please wait before asking for a new code.", OTP_RESEND_SECONDS - (now - sends[-1]))
    if len(sends) >= OTP_SENDS_PER_HOUR:
        raise _too_many("Too many codes were requested for this number.", 3600 - (now - sends[0]))
    sends.append(now)
    _sent_otps[phone] = code
    _verified_phones.discard(phone)
    return {"sent": True}


@app.post("/auth/otp/verify")
def verify_otp(body: OtpVerifyInput):
    payload = body.model_dump()
    phone = _normalize_phone(str(payload.get("phone", "")))
    otp = str(payload.get("otp", "")).strip()
    now = time.monotonic()
    failures = _recent(_otp_failures, phone, OTP_FAILED_VERIFY_WINDOW, now)
    if len(failures) >= OTP_FAILED_VERIFY_LIMIT:
        raise _too_many("Too many wrong codes.", OTP_FAILED_VERIFY_WINDOW - (now - failures[0]))
    verified = _sent_otps.get(phone) == otp and len(otp) == 6
    if verified:
        _verified_phones.add(phone)
        _otp_failures.pop(phone, None)
    else:
        _verified_phones.discard(phone)
        failures.append(now)
    return {"verified": verified}


@app.post("/auth/signup")
def signup(payload: SignupInput, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    phone = _normalize_phone(payload.phone)
    if not payload.otp or phone not in _verified_phones or _sent_otps.get(phone) != payload.otp:
        raise HTTPException(status_code=400, detail="Verify the development OTP before signing up.")
    _verified_phones.discard(phone)
    _sent_otps.pop(phone, None)

    try:
        auth_user = create_auth_user(email, payload.password)
    except SupabaseRequestError as error:
        if error.status_code in {400, 409, 422}:
            raise HTTPException(
                status_code=409,
                detail="An account with this email already exists or could not be created.",
                headers={"X-Error-Field": "email"},
            ) from error
        raise HTTPException(status_code=502, detail="Could not create the Supabase Auth account.") from error

    user_id = auth_user.get("id")
    if not isinstance(user_id, str):
        raise HTTPException(status_code=502, detail="Supabase Auth returned an invalid user id.")

    try:
        _set_actor(db, user_id)
        shop = db.execute(
            text(
                """
                insert into public.shops (owner_user_id, city, business_domain)
                values (:user_id, :city, :business_domain)
                returning id
                """
            ),
            {
                "user_id": user_id,
                "city": payload.city.strip(),
                "business_domain": payload.businessDomain.strip(),
            },
        ).mappings().one()
        db.execute(
            text(
                """
                insert into public.profiles (user_id, shop_id, owner_name, phone, email)
                values (:user_id, :shop_id, :owner_name, :phone, :email)
                """
            ),
            {
                "user_id": user_id,
                "shop_id": shop["id"],
                "owner_name": payload.name.strip(),
                "phone": phone,
                "email": email,
            },
        )
        db.execute(
            text("insert into public.user_settings (user_id) values (:user_id)"),
            {"user_id": user_id},
        )
        auth_session = sign_in_with_password(email, payload.password)
        public_user = _public_user(db, user_id)
        session = _auth_session(auth_session, public_user)
        db.commit()
    except (SupabaseNotConfigured, SupabaseRequestError) as error:
        db.rollback()
        _cleanup_auth_user(user_id)
        raise HTTPException(
            status_code=502,
            detail="Supabase Auth could not create a sign-in session for the new account.",
        ) from error
    except HTTPException:
        db.rollback()
        _cleanup_auth_user(user_id)
        raise
    except IntegrityError as error:
        db.rollback()
        _cleanup_auth_user(user_id)
        raise HTTPException(
            status_code=409,
            detail="An account with this email or phone number already exists.",
            headers={"X-Error-Field": "phone"},
        ) from error
    except SQLAlchemyError as error:
        db.rollback()
        _cleanup_auth_user(user_id)
        logger.exception("Could not provision the Supabase shop profile", exc_info=error)
        raise HTTPException(status_code=503, detail="Could not provision the shop profile.") from error
    return session


@app.post("/auth/login")
def login(payload: LoginInput, db: Session = Depends(get_db)):
    identifier = payload.identifier.strip()
    if payload.method == "phone":
        phone = _normalize_phone(identifier)
        row = _one(
            db,
            "select email from public.profiles where phone = :phone",
            {"phone": phone},
        )
        if row is None:
            raise HTTPException(
                status_code=401,
                detail="Incorrect login details or password.",
                headers={"X-Error-Field": "password"},
            )
        email = row["email"]
    elif payload.method == "email":
        email = identifier.lower()
    else:
        raise HTTPException(status_code=422, detail="Login method must be phone or email.")

    try:
        auth_session = sign_in_with_password(email, payload.password)
    except SupabaseRequestError as error:
        if error.status_code in {400, 401, 403}:
            raise HTTPException(
                status_code=401,
                detail="Incorrect login details or password.",
                headers={"X-Error-Field": "password"},
            ) from error
        raise HTTPException(status_code=502, detail="Supabase Auth sign-in failed.") from error

    auth_user = auth_session.get("user") or {}
    user_id = auth_user.get("id")
    if not isinstance(user_id, str):
        raise HTTPException(status_code=502, detail="Supabase Auth returned an invalid user id.")
    return _auth_session(auth_session, _public_user(db, user_id))


@app.post("/auth/refresh")
def refresh_session(payload: RefreshInput, db: Session = Depends(get_db)):
    try:
        auth_session = refresh_auth_session(payload.refreshToken)
    except SupabaseRequestError as error:
        if error.status_code in {400, 401, 403}:
            raise HTTPException(status_code=401, detail="Session expired. Please log in again.") from error
        raise HTTPException(status_code=502, detail="Supabase Auth session refresh failed.") from error
    auth_user = auth_session.get("user") or {}
    user_id = auth_user.get("id")
    if not isinstance(user_id, str):
        raise HTTPException(status_code=502, detail="Supabase Auth returned an invalid user id.")
    return _auth_session(auth_session, _public_user(db, user_id))


@app.post("/auth/logout")
def logout(authorization: Optional[str] = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        try:
            sign_out(authorization.split(" ", 1)[1])
        except SupabaseRequestError as error:
            if error.status_code not in {401, 403}:
                raise HTTPException(status_code=502, detail="Supabase Auth sign-out failed.") from error
    return {"message": "Logged out"}


@app.get("/auth/me")
def auth_me(
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    return _public_user(db, context.user_id)


def _decode_avatar_data_url(value: str) -> tuple[str, bytes] | None:
    if not value.startswith("data:"):
        return None
    match = re.fullmatch(r"data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)", value)
    if match is None:
        raise HTTPException(status_code=422, detail="Avatar must be a JPEG, PNG, or WebP image.")
    try:
        content = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=422, detail="Avatar image data is invalid.") from error
    if not content or len(content) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=413, detail="Avatar images must be 2 MB or smaller.")
    return match.group(1), content


@app.put("/auth/profile")
def update_profile(
    payload: ProfileInput,
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    phone = _normalize_phone(payload.phone)
    avatar = _decode_avatar_data_url(payload.avatarUrl)
    avatar_path = None
    if avatar:
        media_type, content = avatar
        extension = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[media_type]
        avatar_path = f"{context.shop_id}/{context.user_id}.{extension}"
        try:
            upload_storage_object("avatars", avatar_path, content, media_type, upsert=True)
        except SupabaseRequestError as error:
            raise HTTPException(status_code=502, detail="Could not upload the profile avatar.") from error

    try:
        _set_actor(db, context.user_id)
        db.execute(
            text(
                """
                update public.shops
                   set shop_name = :shop_name,
                       business_domain = :business_domain,
                       address = :address,
                       gst_number = :gst_number,
                       fssai_number = :fssai_number
                 where id = :shop_id and owner_user_id = :user_id
                """
            ),
            {
                "shop_name": payload.shopName.strip(),
                "business_domain": payload.businessDomain.strip(),
                "address": payload.address.strip(),
                "gst_number": payload.gstNumber.strip() or None,
                "fssai_number": payload.fssaiNumber.strip() or None,
                "shop_id": context.shop_id,
                "user_id": context.user_id,
            },
        )
        profile_values = {
            "owner_name": payload.ownerName.strip(),
            "phone": phone,
            "primary_language": payload.primaryLanguage,
            "secondary_language": payload.secondaryLanguage,
            "shop_id": context.shop_id,
            "user_id": context.user_id,
        }
        avatar_clause = ""
        if avatar_path:
            avatar_clause = ", avatar_path = :avatar_path"
            profile_values["avatar_path"] = avatar_path
        db.execute(
            text(
                f"""
                update public.profiles
                   set owner_name = :owner_name,
                       phone = :phone,
                       primary_language = :primary_language,
                       secondary_language = :secondary_language
                       {avatar_clause}
                 where user_id = :user_id and shop_id = :shop_id
                """
            ),
            profile_values,
        )
        db.execute(
            text(
                """
                update public.user_settings
                   set spoken_replies = :spoken_replies,
                       voice_speed = :voice_speed,
                       voice_volume = :voice_volume,
                       daily_ledger_pdf = :daily_ledger_pdf,
                       low_stock_alert = :low_stock_alert,
                       payment_reminder = :payment_reminder
                 where user_id = :user_id
                """
            ),
            {
                "spoken_replies": payload.spokenReplies,
                "voice_speed": payload.voiceSpeed,
                "voice_volume": payload.voiceVolume,
                "daily_ledger_pdf": payload.dailyLedgerPdf,
                "low_stock_alert": payload.lowStockAlert,
                "payment_reminder": payload.paymentReminder,
                "user_id": context.user_id,
            },
        )
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="An account with this phone number already exists.",
            headers={"X-Error-Field": "phone"},
        ) from error
    except SQLAlchemyError:
        db.rollback()
        raise
    return _public_user(db, context.user_id)


def _product_dict(row) -> dict:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "category": row["category"],
        "selling_price": _rupees(row["selling_price_paise"]),
        "purchase_price": _rupees(row["purchase_price_paise"]),
        "stock_quantity": float(row["stock_qty"]),
        "unit": row["unit"],
        "expiry_date": _iso(row["expiry_date"]),
        "low_stock_threshold": float(row["low_stock_threshold"]),
    }


def _product_row(db: Session, shop_id: str, product_id: str):
    return _one(
        db,
        """
        select id, name, category, selling_price_paise, purchase_price_paise,
               stock_qty, unit, expiry_date, low_stock_threshold
          from public.products
         where id = :product_id and shop_id = :shop_id and archived_at is null
        """,
        {"product_id": product_id, "shop_id": shop_id},
    )


def _insert_stock_movement(
    db: Session,
    *,
    shop_id: str,
    product_id: str,
    quantity_change: Decimal,
    reason: str,
    note: str | None = None,
    entry_id: str | None = None,
) -> None:
    if quantity_change == 0:
        return
    db.execute(
        text(
            """
            insert into public.stock_movements
                (shop_id, product_id, entry_id, qty_change, reason, note)
            values
                (:shop_id, :product_id, :entry_id, :qty_change, :reason, :note)
            """
        ),
        {
            "shop_id": shop_id,
            "product_id": product_id,
            "entry_id": entry_id,
            "qty_change": quantity_change,
            "reason": reason,
            "note": note,
        },
    )


@app.get("/products")
def get_products(
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    rows = _all(
        db,
        """
        select id, name, category, selling_price_paise, purchase_price_paise,
               stock_qty, unit, expiry_date, low_stock_threshold
          from public.products
         where shop_id = :shop_id and archived_at is null
         order by name
        """,
        {"shop_id": context.shop_id},
    )
    return [_product_dict(row) for row in rows]


@app.post("/products")
def add_product(
    body: ProductCreate,
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    payload = body.model_dump(exclude_unset=True)
    name = str(payload.get("name") or payload.get("product_name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Product name is required.")
    selling_price = _paise(payload.get("selling_price"), "selling_price")
    purchase_price_value = payload.get("purchase_price")
    purchase_price = (
        _paise(purchase_price_value, "purchase_price")
        if purchase_price_value not in (None, "")
        else None
    )
    stock_qty = _nonnegative_quantity(payload.get("stock_quantity", 0), "stock_quantity")
    threshold = _nonnegative_quantity(payload.get("low_stock_threshold", 5), "low_stock_threshold")
    try:
        _set_actor(db, context.user_id)
        row = db.execute(
            text(
                """
                insert into public.products
                    (shop_id, name, category, selling_price_paise, purchase_price_paise,
                     unit, expiry_date, low_stock_threshold)
                values
                    (:shop_id, :name, :category, :selling_price, :purchase_price,
                     :unit, :expiry_date, :threshold)
                returning id
                """
            ),
            {
                "shop_id": context.shop_id,
                "name": name,
                "category": str(payload.get("category") or "").strip() or None,
                "selling_price": selling_price,
                "purchase_price": purchase_price,
                "unit": str(payload.get("unit") or "pcs").strip() or "pcs",
                "expiry_date": parse_date(payload.get("expiry_date")),
                "threshold": threshold,
            },
        ).mappings().one()
        product_id = str(row["id"])
        if stock_qty:
            _insert_stock_movement(
                db,
                shop_id=context.shop_id,
                product_id=product_id,
                quantity_change=stock_qty,
                reason="opening",
                note="Initial stock",
            )
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="A product with this name already exists.") from error
    except SQLAlchemyError:
        db.rollback()
        raise
    return _product_dict(_product_row(db, context.shop_id, product_id))


@app.put("/products/{product_id}")
def update_product(
    product_id: uuid.UUID,
    body: ProductUpdate,
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    payload = body.model_dump(exclude_unset=True)
    identifier = str(product_id)
    existing = _product_row(db, context.shop_id, identifier)
    if existing is None:
        raise HTTPException(status_code=404, detail="Product not found.")

    updates = dict(payload)
    if "name" not in updates and "product_name" in updates:
        updates["name"] = updates.pop("product_name")
    allowed = {
        "name": ("name", lambda value: str(value).strip()),
        "category": ("category", lambda value: str(value).strip() or None if value is not None else None),
        "selling_price": ("selling_price_paise", lambda value: _paise(value, "selling_price")),
        "purchase_price": (
            "purchase_price_paise",
            lambda value: _paise(value, "purchase_price") if value not in (None, "") else None,
        ),
        "unit": ("unit", lambda value: str(value).strip() or "pcs"),
        "expiry_date": ("expiry_date", parse_date),
        "low_stock_threshold": ("low_stock_threshold", lambda value: _quantity(value, "low_stock_threshold")),
    }
    assignments = []
    values = {"product_id": identifier, "shop_id": context.shop_id}
    for key, (column, convert) in allowed.items():
        if key in updates:
            assignments.append(f"{column} = :{key}")
            values[key] = convert(updates[key])

    stock_delta = Decimal("0")
    if "stock_quantity" in updates:
        target_stock = _nonnegative_quantity(updates["stock_quantity"], "stock_quantity")
        stock_delta = target_stock - Decimal(str(existing["stock_qty"]))

    if not assignments and stock_delta == 0:
        return _product_dict(existing)

    try:
        _set_actor(db, context.user_id)
        if assignments:
            result = db.execute(
                text(
                    f"""
                    update public.products
                       set {", ".join(assignments)}
                     where id = :product_id and shop_id = :shop_id and archived_at is null
                    """
                ),
                values,
            )
            if result.rowcount == 0:
                db.rollback()
                raise HTTPException(status_code=404, detail="Product not found.")
        if stock_delta:
            _insert_stock_movement(
                db,
                shop_id=context.shop_id,
                product_id=identifier,
                quantity_change=stock_delta,
                reason="adjustment",
                note="Inventory adjustment",
            )
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Product update conflicts with the shop's inventory.") from error
    except SQLAlchemyError:
        db.rollback()
        raise
    return _product_dict(_product_row(db, context.shop_id, identifier))


@app.delete("/products/{product_id}")
def delete_product(
    product_id: uuid.UUID,
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    try:
        _set_actor(db, context.user_id)
        result = db.execute(
            text(
                """
                update public.products set archived_at = now()
                 where id = :product_id and shop_id = :shop_id and archived_at is null
                """
            ),
            {"product_id": str(product_id), "shop_id": context.shop_id},
        )
        if result.rowcount == 0:
            db.rollback()
            raise HTTPException(status_code=404, detail="Product not found.")
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise
    return {"message": "Product archived successfully"}


def _balance_paise(db: Session, shop_id: str, customer_id: str) -> int:
    row = _one(
        db,
        """
        select coalesce(
            (select balance_paise from public.customer_balances
              where shop_id = :shop_id and customer_id = :customer_id),
            0
        ) as balance_paise
        """,
        {"shop_id": shop_id, "customer_id": customer_id},
    )
    return int(row["balance_paise"])


def _customer_dict(row) -> dict:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "phone_number": row["phone"],
        "whatsapp_number": row["whatsapp"],
        "outstanding_balance": _rupees(row["balance_paise"] or 0),
        "credit_score": float(row["credit_score"]) if row["credit_score"] is not None else None,
    }


def _customer_row(db: Session, shop_id: str, customer_id: str):
    return _one(
        db,
        """
        select c.id, c.name, c.phone, c.whatsapp, c.credit_score,
               coalesce(b.balance_paise, 0) as balance_paise
          from public.customers c
          left join public.customer_balances b
            on b.shop_id = c.shop_id and b.customer_id = c.id
         where c.id = :customer_id and c.shop_id = :shop_id and c.archived_at is null
        """,
        {"customer_id": customer_id, "shop_id": shop_id},
    )


def _insert_balance_entry(
    db: Session,
    *,
    shop_id: str,
    customer_id: str,
    amount: int,
    entry_type: str,
    reference_id: str | None = None,
    delta: int | None = None,
    note: str | None = None,
) -> None:
    db.execute(
        text(
            """
            insert into public.ledger_entries
                (shop_id, customer_id, type, amount_paise, paid_paise,
                 due_delta_paise, ref_entry_id, source, note)
            values
                (:shop_id, :customer_id, :entry_type, :amount, 0,
                 :delta, :reference_id, 'manual', :note)
            """
        ),
        {
            "shop_id": shop_id,
            "customer_id": customer_id,
            "entry_type": entry_type,
            "amount": amount,
            "delta": delta or 0,
            "reference_id": reference_id,
            "note": note,
        },
    )


def _normalise_customer_phone(value) -> str | None:
    if value is None or not str(value).strip():
        return None
    return _normalize_phone(str(value), required=False)


@app.get("/customers")
def get_customers(
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    rows = _all(
        db,
        """
        select c.id, c.name, c.phone, c.whatsapp, c.credit_score,
               coalesce(b.balance_paise, 0) as balance_paise
          from public.customers c
          left join public.customer_balances b
            on b.shop_id = c.shop_id and b.customer_id = c.id
         where c.shop_id = :shop_id and c.archived_at is null
         order by c.name
        """,
        {"shop_id": context.shop_id},
    )
    return [_customer_dict(row) for row in rows]


@app.post("/customers")
def add_customer(
    body: CustomerCreate,
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    payload = body.model_dump(exclude_unset=True)
    name = str(payload.get("name") or payload.get("customer_name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Customer name is required.")
    phone = _normalise_customer_phone(payload.get("phone_number"))
    whatsapp = _normalise_customer_phone(payload.get("whatsapp_number"))
    credit_score_value = payload.get("credit_score")
    credit_score = _decimal(credit_score_value, "credit_score") if credit_score_value not in (None, "") else None
    if credit_score is not None and credit_score < 0:
        raise HTTPException(status_code=422, detail="credit_score cannot be negative.")
    balance = _paise(payload.get("outstanding_balance", 0), "outstanding_balance", default=Decimal("0"))

    try:
        _set_actor(db, context.user_id)
        row = db.execute(
            text(
                """
                insert into public.customers (shop_id, name, phone, whatsapp, credit_score)
                values (:shop_id, :name, :phone, :whatsapp, :credit_score)
                returning id
                """
            ),
            {
                "shop_id": context.shop_id,
                "name": name,
                "phone": phone,
                "whatsapp": whatsapp,
                "credit_score": credit_score,
            },
        ).mappings().one()
        customer_id = str(row["id"])
        if balance:
            _insert_balance_entry(
                db,
                shop_id=context.shop_id,
                customer_id=customer_id,
                amount=balance,
                entry_type="opening_balance",
                note="Opening customer balance",
            )
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Customer details conflict with existing shop data.") from error
    except SQLAlchemyError:
        db.rollback()
        raise
    return _customer_dict(_customer_row(db, context.shop_id, customer_id))


@app.put("/customers/{customer_id}")
def update_customer(
    customer_id: uuid.UUID,
    body: CustomerUpdate,
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    payload = body.model_dump(exclude_unset=True)
    identifier = str(customer_id)
    existing = _customer_row(db, context.shop_id, identifier)
    if existing is None:
        raise HTTPException(status_code=404, detail="Customer not found.")
    updates = dict(payload)
    if "name" not in updates and "customer_name" in updates:
        updates["name"] = updates.pop("customer_name")

    allowed = {
        "name": ("name", lambda value: str(value).strip()),
        "phone_number": ("phone", _normalise_customer_phone),
        "whatsapp_number": ("whatsapp", _normalise_customer_phone),
        "credit_score": (
            "credit_score",
            lambda value: _decimal(value, "credit_score") if value not in (None, "") else None,
        ),
    }
    assignments = []
    values = {"customer_id": identifier, "shop_id": context.shop_id}
    for key, (column, convert) in allowed.items():
        if key in updates:
            assignments.append(f"{column} = :{key}")
            values[key] = convert(updates[key])

    # A balance changes only through bills, payments, undo (reversal) or the opening balance
    # entered once when the customer is created. Sending the current value back is fine.
    if updates.get("outstanding_balance") not in (None, ""):
        target_balance = _paise(updates["outstanding_balance"], "outstanding_balance")
        if target_balance != int(existing["balance_paise"] or 0):
            raise HTTPException(
                status_code=422,
                detail=BALANCE_EDIT_REFUSED,
                headers={"X-Error-Field": "outstanding_balance"},
            )

    if not assignments:
        return _customer_dict(existing)

    try:
        _set_actor(db, context.user_id)
        if assignments:
            result = db.execute(
                text(
                    f"""
                    update public.customers
                       set {", ".join(assignments)}
                     where id = :customer_id and shop_id = :shop_id and archived_at is null
                    """
                ),
                values,
            )
            if result.rowcount == 0:
                db.rollback()
                raise HTTPException(status_code=404, detail="Customer not found.")
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Customer update conflicts with existing shop data.") from error
    except SQLAlchemyError:
        db.rollback()
        raise
    return _customer_dict(_customer_row(db, context.shop_id, identifier))


@app.delete("/customers/{customer_id}")
def delete_customer(
    customer_id: uuid.UUID,
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    try:
        _set_actor(db, context.user_id)
        result = db.execute(
            text(
                """
                update public.customers set archived_at = now()
                 where id = :customer_id and shop_id = :shop_id and archived_at is null
                """
            ),
            {"customer_id": str(customer_id), "shop_id": context.shop_id},
        )
        if result.rowcount == 0:
            db.rollback()
            raise HTTPException(status_code=404, detail="Customer not found.")
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise
    return {"message": "Customer archived successfully"}


def _entry_dict(row) -> dict:
    payment_mode = row["payment_mode"]
    if payment_mode == "udhaar":
        payment_method = "credit"
    else:
        payment_method = payment_mode
    amount = _rupees(row["amount_paise"])
    paid = _rupees(row["paid_paise"])
    entry_type = row["type"]
    return {
        "id": str(row["id"]),
        "transaction_type": entry_type,
        "customer_id": str(row["customer_id"]) if row["customer_id"] else None,
        "total_amount": amount,
        "paid_amount": paid,
        "payment_method": payment_method,
        "transaction_date": _iso(row["created_at"]),
        "status": "paid" if row["paid_paise"] >= row["amount_paise"] else "partial",
        "notes": row["note"],
        "type": entry_type,
        "due_delta": _rupees(row["due_delta_paise"]),
    }


def _entry_row(db: Session, shop_id: str, entry_id: str):
    return _one(
        db,
        """
        select id, shop_id, customer_id, type, amount_paise, paid_paise,
               due_delta_paise, payment_mode, note, created_at
          from public.ledger_entries
         where id = :entry_id and shop_id = :shop_id
        """,
        {"entry_id": entry_id, "shop_id": shop_id},
    )


def _public_items(db: Session, shop_id: str, entry_id: str) -> list[dict]:
    rows = _all(
        db,
        """
        select id, entry_id, product_id, product_name_snapshot, qty,
               unit_price_paise, line_total_paise
          from public.ledger_items
         where shop_id = :shop_id and entry_id = :entry_id
         order by created_at, id
        """,
        {"shop_id": shop_id, "entry_id": entry_id},
    )
    return [
        {
            "id": str(row["id"]),
            "transaction_id": str(row["entry_id"]),
            "product_id": str(row["product_id"]) if row["product_id"] else None,
            "product_name": row["product_name_snapshot"],
            "quantity": float(row["qty"]),
            "unit_price": _rupees(row["unit_price_paise"]),
            "line_total": _rupees(row["line_total_paise"]),
        }
        for row in rows
    ]


@app.get("/transactions")
def get_transactions(
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    rows = _all(
        db,
        """
        select id, shop_id, customer_id, type, amount_paise, paid_paise,
               due_delta_paise, payment_mode, note, created_at
          from public.ledger_entries
         where shop_id = :shop_id
         order by created_at desc, id desc
         limit 100
        """,
        {"shop_id": context.shop_id},
    )
    return [_entry_dict(row) for row in rows]


@app.get("/transactions/{transaction_id}/items")
def get_transaction_items(
    transaction_id: uuid.UUID,
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    identifier = str(transaction_id)
    if _entry_row(db, context.shop_id, identifier) is None:
        raise HTTPException(status_code=404, detail="Transaction not found.")
    return _public_items(db, context.shop_id, identifier)


def _create_payment_entry(
    db: Session,
    context: AuthContext,
    customer_id: str,
    amount_paise: int,
    payment_method: str,
    note: str | None,
) -> dict:
    if payment_method not in {"cash", "upi"}:
        raise HTTPException(status_code=422, detail="Payments must use cash or upi.")
    customer = _customer_row(db, context.shop_id, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found.")
    current_balance = int(customer["balance_paise"] or 0)
    if amount_paise > current_balance:
        raise HTTPException(status_code=422, detail="Payment cannot exceed outstanding balance.")

    _set_actor(db, context.user_id)
    row = db.execute(
        text(
            """
            insert into public.ledger_entries
                (shop_id, customer_id, type, amount_paise, paid_paise,
                 payment_mode, source, note)
            values
                (:shop_id, :customer_id, 'payment', :amount, :amount,
                 :payment_method, 'manual', :note)
            returning id, shop_id, customer_id, type, amount_paise, paid_paise,
                      due_delta_paise, payment_mode, note, created_at
            """
        ),
        {
            "shop_id": context.shop_id,
            "customer_id": customer_id,
            "amount": amount_paise,
            "payment_method": payment_method,
            "note": note,
        },
    ).mappings().one()
    return _entry_dict(row)


@app.post("/transactions")
def create_transaction(
    payload: TransactionCreate,
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    transaction_type = payload.transaction_type.strip().lower()
    if transaction_type == "purchase":
        raise HTTPException(
            status_code=501,
            detail="Purchase transactions are disabled until the restock mapping is confirmed.",
        )
    if transaction_type == "payment":
        raise HTTPException(status_code=422, detail="Use POST /payments to record a customer payment.")
    if transaction_type != "sale":
        raise HTTPException(status_code=422, detail="transaction_type must be sale, purchase, or payment.")
    if not payload.items:
        raise HTTPException(status_code=422, detail="At least one item is required.")

    customer_id = _to_uuid(payload.customer_id, "customer_id") if payload.customer_id else None
    customer = _customer_row(db, context.shop_id, customer_id) if customer_id else None
    if customer_id and customer is None:
        raise HTTPException(status_code=404, detail="Customer not found.")

    prepared_items = []
    total_paise = 0
    for item in payload.items:
        product_id = _to_uuid(item.product_id, "product_id")
        product = _product_row(db, context.shop_id, product_id)
        if product is None:
            raise HTTPException(status_code=404, detail=f"Product {product_id} not found.")
        if product["selling_price_paise"] is None:
            raise HTTPException(status_code=422, detail=f"Product {product['name']} has no selling price.")
        quantity = _quantity(item.quantity)
        unit_price = int(product["selling_price_paise"])
        line_total = int(
            (quantity * unit_price).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        )
        total_paise += line_total
        prepared_items.append((product, product_id, quantity, unit_price, line_total))

    method = payload.payment_method.strip().lower()
    if method not in {"cash", "upi", "credit", "udhaar"}:
        raise HTTPException(status_code=422, detail="payment_method must be cash, upi, or credit.")
    default_paid = Decimal("0") if method in {"credit", "udhaar"} else Decimal(total_paise) / 100
    paid_paise = _paise(payload.paid_amount, "paid_amount", default=default_paid)
    if paid_paise > total_paise:
        raise HTTPException(status_code=422, detail="paid_amount cannot exceed the sale total.")
    if customer_id is None and paid_paise != total_paise:
        raise HTTPException(status_code=422, detail="Walk-in sales must be fully paid.")
    if paid_paise == total_paise:
        if method in {"credit", "udhaar"}:
            raise HTTPException(status_code=422, detail="A fully paid sale must use cash or upi.")
        payment_mode = method
    elif paid_paise == 0:
        payment_mode = "udhaar"
    else:
        payment_mode = "partial"

    try:
        _set_actor(db, context.user_id)
        entry = db.execute(
            text(
                """
                insert into public.ledger_entries
                    (shop_id, customer_id, type, amount_paise, paid_paise,
                     payment_mode, source, note)
                values
                    (:shop_id, :customer_id, 'sale', :amount, :paid,
                     :payment_mode, 'manual', :note)
                returning id, shop_id, customer_id, type, amount_paise, paid_paise,
                          due_delta_paise, payment_mode, note, created_at
                """
            ),
            {
                "shop_id": context.shop_id,
                "customer_id": customer_id,
                "amount": total_paise,
                "paid": paid_paise,
                "payment_mode": payment_mode,
                "note": payload.notes,
            },
        ).mappings().one()
        entry_id = str(entry["id"])
        for product, product_id, quantity, unit_price, line_total in prepared_items:
            db.execute(
                text(
                    """
                    insert into public.ledger_items
                        (shop_id, entry_id, product_id, product_name_snapshot,
                         qty, unit, unit_price_paise, line_total_paise)
                    values
                        (:shop_id, :entry_id, :product_id, :product_name,
                         :quantity, :unit, :unit_price, :line_total)
                    """
                ),
                {
                    "shop_id": context.shop_id,
                    "entry_id": entry_id,
                    "product_id": product_id,
                    "product_name": product["name"],
                    "quantity": quantity,
                    "unit": product["unit"],
                    "unit_price": unit_price,
                    "line_total": line_total,
                },
            )
            _insert_stock_movement(
                db,
                shop_id=context.shop_id,
                product_id=product_id,
                quantity_change=-quantity,
                reason="sale",
                entry_id=entry_id,
            )
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Sale could not be recorded; verify available stock and line totals.",
        ) from error
    except SQLAlchemyError:
        db.rollback()
        raise

    saved = _entry_row(db, context.shop_id, entry_id)
    return {
        "message": "Transaction created successfully",
        "transaction": _entry_dict(saved),
        "items": _public_items(db, context.shop_id, entry_id),
        "outstanding_change": _rupees(total_paise - paid_paise) if customer_id else 0,
    }


@app.post("/transactions/{transaction_id}/reverse")
def reverse_transaction(
    transaction_id: uuid.UUID,
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    identifier = str(transaction_id)
    original = _entry_row(db, context.shop_id, identifier)
    if original is None:
        raise HTTPException(status_code=404, detail="Transaction not found.")
    if original["type"] == "reversal":
        raise HTTPException(status_code=409, detail="A reversal cannot itself be reversed.")
    items = _all(
        db,
        """
        select product_id, qty from public.ledger_items
         where shop_id = :shop_id and entry_id = :entry_id
        """,
        {"shop_id": context.shop_id, "entry_id": identifier},
    )
    try:
        _set_actor(db, context.user_id)
        row = db.execute(
            text(
                """
                insert into public.ledger_entries
                    (shop_id, customer_id, type, amount_paise, paid_paise,
                     due_delta_paise, ref_entry_id, source, note)
                values
                    (:shop_id, :customer_id, 'reversal', 0, 0, 0, :entry_id, 'manual', 'Transaction reversal')
                returning id, shop_id, customer_id, type, amount_paise, paid_paise,
                          due_delta_paise, payment_mode, note, created_at
                """
            ),
            {
                "shop_id": context.shop_id,
                "customer_id": original["customer_id"],
                "entry_id": identifier,
            },
        ).mappings().one()
        reversal_id = str(row["id"])
        if original["type"] == "sale":
            for item in items:
                if item["product_id"]:
                    _insert_stock_movement(
                        db,
                        shop_id=context.shop_id,
                        product_id=str(item["product_id"]),
                        quantity_change=Decimal(str(item["qty"])),
                        reason="reversal",
                        entry_id=reversal_id,
                    )
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="This transaction has already been reversed or cannot be reversed.") from error
    except SQLAlchemyError:
        db.rollback()
        raise
    return {
        "message": "Transaction reversed successfully",
        "transaction": _entry_dict(_entry_row(db, context.shop_id, reversal_id)),
    }


@app.delete("/transactions/{transaction_id}")
def delete_transaction(transaction_id: uuid.UUID):
    _ = transaction_id
    raise HTTPException(
        status_code=405,
        detail="Ledger entries are append-only. Use POST /transactions/{transaction_id}/reverse.",
    )


@app.post("/payments")
def create_payment(
    payload: PaymentCreate,
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    customer_id = _to_uuid(payload.customer_id, "customer_id")
    amount = _paise(payload.amount, "amount")
    try:
        payment = _create_payment_entry(
            db,
            context,
            customer_id,
            amount,
            payload.payment_method.strip().lower(),
            payload.notes,
        )
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=422, detail="Payment conflicts with the customer ledger.") from error
    except SQLAlchemyError:
        db.rollback()
        raise
    return {
        "message": "Payment recorded successfully",
        "payment": payment,
        "outstanding_balance": _rupees(_balance_paise(db, context.shop_id, customer_id)),
    }


@app.get("/payments")
def get_payments(
    customer_id: Optional[str] = None,
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    values = {"shop_id": context.shop_id}
    customer_clause = ""
    if customer_id is not None:
        values["customer_id"] = _to_uuid(customer_id, "customer_id")
        customer_clause = "and customer_id = :customer_id"
    rows = _all(
        db,
        f"""
        select id, shop_id, customer_id, type, amount_paise, paid_paise,
               due_delta_paise, payment_mode, note, created_at
          from public.ledger_entries
         where shop_id = :shop_id and type = 'payment' {customer_clause}
         order by created_at desc, id desc limit 100
        """,
        values,
    )
    return [_entry_dict(row) for row in rows]


@app.get("/customers/{customer_id}/ledger")
def get_customer_ledger(
    customer_id: uuid.UUID,
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    identifier = str(customer_id)
    customer = _customer_row(db, context.shop_id, identifier)
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found.")
    rows = _all(
        db,
        """
        select id, shop_id, customer_id, type, amount_paise, paid_paise,
               due_delta_paise, payment_mode, note, created_at
          from public.ledger_entries
         where shop_id = :shop_id and customer_id = :customer_id
         order by created_at desc, id desc
        """,
        {"shop_id": context.shop_id, "customer_id": identifier},
    )
    entries = [_entry_dict(row) for row in rows]
    return {
        "customer": _customer_dict(customer),
        "outstanding_balance": _rupees(customer["balance_paise"] or 0),
        "transactions": [entry for entry in entries if entry["transaction_type"] != "payment"],
        "payments": [entry for entry in entries if entry["transaction_type"] == "payment"],
    }


def _public_report(report, attachments: list[dict]) -> dict:
    return {
        "id": str(report["id"]),
        "reference": report["reference"],
        "categories": list(report["categories"]),
        "description": report["description"],
        "contactAllowed": report["contact_allowed"],
        "attachments": [
            {"name": item["name"], "type": item["media_type"], "size": item["size_bytes"]}
            for item in attachments
        ],
        "createdAt": _iso(report["created_at"]),
    }


def _cleanup_report_uploads(paths: list[str]) -> None:
    try:
        delete_storage_objects("support-attachments", paths)
    except SupabaseRequestError as error:
        logger.exception("Could not remove uploaded support attachments after a failed report")
        raise HTTPException(
            status_code=502,
            detail="Report creation failed and uploaded files need manual cleanup.",
        ) from error


@app.post("/support/reports")
def create_support_report(
    categories: str = Form(...),
    description: str = Form(...),
    contactAllowed: str = Form(...),
    attachments: list[UploadFile] = File(default=[]),
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    try:
        parsed_categories = json.loads(categories)
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=422, detail="Issue categories must be valid JSON.") from error
    if not isinstance(parsed_categories, list) or not parsed_categories or len(parsed_categories) > 8:
        raise HTTPException(status_code=422, detail="Choose between 1 and 8 issue categories.")
    if any(not isinstance(category, str) or not category.strip() for category in parsed_categories):
        raise HTTPException(status_code=422, detail="Issue categories must be non-empty strings.")
    cleaned_description = description.strip()
    if not cleaned_description or len(cleaned_description) > 1000:
        raise HTTPException(status_code=422, detail="Describe the issue in 1 to 1000 characters.")
    if contactAllowed not in {"true", "false"}:
        raise HTTPException(status_code=422, detail="contactAllowed must be true or false.")
    if len(attachments) > MAX_REPORT_ATTACHMENTS:
        raise HTTPException(status_code=422, detail="You can attach up to 2 photos.")

    prepared = []
    for attachment in attachments:
        if attachment.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(status_code=422, detail="Issue attachments must be supported image files.")
        content = attachment.file.read(MAX_REPORT_ATTACHMENT_BYTES + 1)
        if len(content) > MAX_REPORT_ATTACHMENT_BYTES:
            raise HTTPException(status_code=413, detail="Issue photos must be 8 MB or smaller.")
        filename = (attachment.filename or "issue-photo").replace("\\", "/").rsplit("/", 1)[-1][:255]
        prepared.append((filename or "issue-photo", attachment.content_type, content))

    uploaded_paths: list[str] = []
    try:
        _set_actor(db, context.user_id)
        report = db.execute(
            text(
                """
                insert into public.support_reports (shop_id, user_id, categories, description, contact_allowed)
                values (:shop_id, :user_id, :categories, :description, :contact_allowed)
                returning id, reference, categories, description, contact_allowed, created_at
                """
            ),
            {
                "shop_id": context.shop_id,
                "user_id": context.user_id,
                "categories": parsed_categories,
                "description": cleaned_description,
                "contact_allowed": contactAllowed == "true",
            },
        ).mappings().one()
        report_id = str(report["id"])
        attachment_rows = []
        for filename, media_type, content in prepared:
            suffix = {
                "image/jpeg": ".jpg",
                "image/png": ".png",
                "image/webp": ".webp",
                "image/gif": ".gif",
                "image/heic": ".heic",
                "image/heif": ".heif",
            }[media_type]
            storage_path = f"{context.shop_id}/{report_id}/{uuid.uuid4()}{suffix}"
            upload_storage_object("support-attachments", storage_path, content, media_type)
            uploaded_paths.append(storage_path)
            row = db.execute(
                text(
                    """
                    insert into public.support_report_attachments
                        (shop_id, report_id, name, media_type, size_bytes, storage_path)
                    values
                        (:shop_id, :report_id, :name, :media_type, :size, :storage_path)
                    returning name, media_type, size_bytes
                    """
                ),
                {
                    "shop_id": context.shop_id,
                    "report_id": report_id,
                    "name": filename,
                    "media_type": media_type,
                    "size": len(content),
                    "storage_path": storage_path,
                },
            ).mappings().one()
            attachment_rows.append(row)
        db.commit()
    except SupabaseRequestError as error:
        db.rollback()
        _cleanup_report_uploads(uploaded_paths)
        raise HTTPException(status_code=502, detail="Could not store the issue report attachment.") from error
    except IntegrityError as error:
        db.rollback()
        _cleanup_report_uploads(uploaded_paths)
        raise HTTPException(status_code=409, detail="Issue report could not be saved.") from error
    except SQLAlchemyError:
        db.rollback()
        _cleanup_report_uploads(uploaded_paths)
        raise
    return _public_report(report, attachment_rows)


@app.get("/support/reports")
def get_support_reports(
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    rows = _all(
        db,
        """
        select r.id, r.reference, r.categories, r.description, r.contact_allowed, r.created_at,
               a.name as attachment_name, a.media_type, a.size_bytes
          from public.support_reports r
          left join public.support_report_attachments a
            on a.shop_id = r.shop_id and a.report_id = r.id
         where r.shop_id = :shop_id and r.user_id = :user_id
         order by r.created_at desc, r.id desc, a.created_at
        """,
        {"shop_id": context.shop_id, "user_id": context.user_id},
    )
    reports = {}
    attachments = {}
    for row in rows:
        report_id = str(row["id"])
        reports.setdefault(report_id, row)
        if row["attachment_name"] is not None:
            attachments.setdefault(report_id, []).append(
                {
                    "name": row["attachment_name"],
                    "media_type": row["media_type"],
                    "size_bytes": row["size_bytes"],
                }
            )
    return [
        _public_report(report, attachments.get(report_id, []))
        for report_id, report in reports.items()
    ]


@app.get("/reports/stock")
def stock_report(
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    products = _all(
        db,
        """
        select id, name, category, selling_price_paise, purchase_price_paise,
               stock_qty, unit, expiry_date, low_stock_threshold
          from public.products
         where shop_id = :shop_id and archived_at is null
        """,
        {"shop_id": context.shop_id},
    )
    selling_value = Decimal("0")
    purchase_value = Decimal("0")
    for product in products:
        quantity = Decimal(str(product["stock_qty"]))
        if product["selling_price_paise"] is not None:
            selling_value += quantity * int(product["selling_price_paise"])
        if product["purchase_price_paise"] is not None:
            purchase_value += quantity * int(product["purchase_price_paise"])
    low_stock = [
        _product_dict(product)
        for product in products
        if product["stock_qty"] <= product["low_stock_threshold"]
    ]
    out_of_stock = [_product_dict(product) for product in products if product["stock_qty"] <= 0]
    return {
        "total_stock_value_at_selling_price": _rupees(selling_value),
        "total_stock_value_at_purchase_price": _rupees(purchase_value),
        "low_stock_products": low_stock,
        "out_of_stock_products": out_of_stock,
    }


@app.get("/reports/sales")
def sales_report(
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    rows = _all(
        db,
        """
        select entry.type, entry.amount_paise, entry.paid_paise,
               original.type as referenced_type,
               original.amount_paise as referenced_amount_paise,
               original.paid_paise as referenced_paid_paise
          from public.ledger_entries entry
          left join public.ledger_entries original
            on original.id = entry.ref_entry_id and original.shop_id = entry.shop_id
         where entry.shop_id = :shop_id
        """,
        {"shop_id": context.shop_id},
    )
    sales = [row for row in rows if row["type"] == "sale"]
    reversed_sales = [
        row for row in rows
        if row["type"] == "reversal" and row["referenced_type"] == "sale"
    ]
    gross_sales_paise = (
        sum(int(row["amount_paise"]) for row in sales)
        - sum(int(row["referenced_amount_paise"]) for row in reversed_sales)
    )
    paid_sales_paise = (
        sum(int(row["paid_paise"]) for row in sales)
        - sum(int(row["referenced_paid_paise"]) for row in reversed_sales)
    )
    balances = _all(
        db,
        "select balance_paise from public.customer_balances where shop_id = :shop_id",
        {"shop_id": context.shop_id},
    )
    outstanding_paise = sum(int(row["balance_paise"]) for row in balances)
    return {
        "gross_sales": _rupees(gross_sales_paise),
        "paid_sales": _rupees(paid_sales_paise),
        "outstanding_from_sales": _rupees(outstanding_paise),
        "gross_purchases": None,
        "estimated_profit": None,
        "sale_count": len(sales),
        "purchase_count": None,
        "purchase_metrics_available": False,
    }


@app.get("/search")
def global_search(
    q: str,
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    term = q.strip()
    if not term:
        return {"products": [], "customers": []}
    products = _all(
        db,
        """
        select result.product_id, result.name, result.unit,
               result.selling_price_paise, result.stock_qty, result.score,
               p.category, p.purchase_price_paise, p.expiry_date, p.low_stock_threshold
          from public.search_products(:shop_id, :query, 20) result
          join public.products p
            on p.id = result.product_id and p.shop_id = :shop_id
           and p.archived_at is null
        """,
        {"shop_id": context.shop_id, "query": term},
    )
    customers = _all(
        db,
        """
        select result.customer_id, result.name, result.locality, result.phone, result.score,
               c.whatsapp, coalesce(b.balance_paise, 0) as balance_paise
          from public.search_customers(:shop_id, :query, 20) result
          join public.customers c
            on c.id = result.customer_id and c.shop_id = :shop_id
           and c.archived_at is null
          left join public.customer_balances b
            on b.shop_id = c.shop_id and b.customer_id = c.id
        """,
        {"shop_id": context.shop_id, "query": term},
    )
    return {
        "products": [
            {
                "id": str(row["product_id"]),
                "name": row["name"],
                "category": row["category"],
                "selling_price": _rupees(row["selling_price_paise"]),
                "purchase_price": _rupees(row["purchase_price_paise"]),
                "stock_quantity": float(row["stock_qty"]),
                "unit": row["unit"],
                "expiry_date": _iso(row["expiry_date"]),
                "low_stock_threshold": float(row["low_stock_threshold"]),
                "score": float(row["score"]),
            }
            for row in products
        ],
        "customers": [
            {
                "id": str(row["customer_id"]),
                "name": row["name"],
                "phone_number": row["phone"],
                "whatsapp_number": row.get("whatsapp"),
                "outstanding_balance": _rupees(row.get("balance_paise") or 0),
                "score": float(row["score"]),
            }
            for row in customers
        ],
    }


@app.post("/voice/process")
def process_voice(payload: VoiceCommandInput):
    spoken = payload.text.strip()
    normalized = spoken.lower()
    if "add product" in normalized or "create product" in normalized:
        intent = "add_product"
        message = "Product creation request recognized."
    elif "add customer" in normalized or "create customer" in normalized:
        intent = "add_customer"
        message = "Customer creation request recognized."
    elif "payment" in normalized or "received" in normalized:
        intent = "payment"
        message = "Payment request recognized."
    elif "sold" in normalized or "sale" in normalized:
        intent = "sale"
        message = "Sale request recognized."
    elif "purchase" in normalized or "stock in" in normalized:
        intent = "purchase"
        message = "Purchase request recognized."
    else:
        intent = "unknown"
        message = "Command could not be understood. Please say add product, sale, purchase, or payment."
    return {
        "recognized_text": spoken,
        "intent": intent,
        "action_required": intent != "unknown",
        "message": message,
    }


@app.get("/dashboard")
def get_dashboard(
    context: AuthContext = Depends(current_auth_context),
    db: Session = Depends(get_db),
):
    products = _all(
        db,
        """
        select id, name, category, selling_price_paise, purchase_price_paise,
               stock_qty, unit, expiry_date, low_stock_threshold
          from public.products
         where shop_id = :shop_id and archived_at is null
        """,
        {"shop_id": context.shop_id},
    )
    customer_count = _one(
        db,
        "select count(*) as count from public.customers where shop_id = :shop_id and archived_at is null",
        {"shop_id": context.shop_id},
    )["count"]
    customers = _all(
        db,
        """
        select balance_paise
          from public.customer_balances
         where shop_id = :shop_id
        """,
        {"shop_id": context.shop_id},
    )
    entries = _all(
        db,
        """
        select entry.type, entry.amount_paise, original.type as referenced_type,
               original.amount_paise as referenced_amount_paise
          from public.ledger_entries entry
          left join public.ledger_entries original
            on original.id = entry.ref_entry_id and original.shop_id = entry.shop_id
         where entry.shop_id = :shop_id
        """,
        {"shop_id": context.shop_id},
    )
    sales = [row for row in entries if row["type"] == "sale"]
    reversed_sales = [
        row for row in entries
        if row["type"] == "reversal" and row["referenced_type"] == "sale"
    ]
    low_stock = [
        _product_dict(product)
        for product in products
        if product["stock_qty"] <= product["low_stock_threshold"]
    ]
    return {
        "total_products": len(products),
        "total_customers": customer_count,
        "total_transactions": len(entries),
        "total_sales": _rupees(
            sum(int(row["amount_paise"]) for row in sales)
            - sum(int(row["referenced_amount_paise"]) for row in reversed_sales)
        ),
        "total_stock": sum(float(product["stock_qty"]) for product in products),
        "total_outstanding": _rupees(sum(int(row["balance_paise"]) for row in customers)),
        "low_stock_count": len(low_stock),
        "low_stock_products": low_stock,
    }


def parse_date(value):
    if not value:
        return None
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Date must use YYYY-MM-DD format.") from error
    raise HTTPException(status_code=422, detail="Date must use YYYY-MM-DD format.")
