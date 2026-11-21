import os
from functools import lru_cache
from urllib.parse import quote

import httpx
import jwt
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientError, PyJWTError


class SupabaseNotConfigured(Exception):
    pass


class SupabaseRequestError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


def is_placeholder(value: str) -> bool:
    """True for the `<...>` placeholders copied from backend/.env.example (e.g. https://<project-ref>.supabase.co)."""
    return "<" in value and ">" in value


def _setting(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SupabaseNotConfigured(f"{name} is not configured in backend/.env.")
    if is_placeholder(value):
        raise SupabaseNotConfigured(
            f"{name} in backend/.env still has the placeholder from .env.example; paste the real value."
        )
    return value


def _project_url() -> str:
    return _setting("SUPABASE_URL").rstrip("/")


def _request(
    method: str,
    path: str,
    *,
    api_key: str,
    bearer: str | None = None,
    json_body: dict | None = None,
    content: bytes | None = None,
    content_type: str | None = None,
    extra_headers: dict[str, str] | None = None,
) -> dict:
    headers = {"apikey": api_key}
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    if content_type:
        headers["Content-Type"] = content_type
    if extra_headers:
        headers.update(extra_headers)

    try:
        with httpx.Client(timeout=20) as client:
            response = client.request(
                method,
                f"{_project_url()}{path}",
                headers=headers,
                json=json_body,
                content=content,
            )
    except httpx.RequestError as error:
        raise SupabaseRequestError(502, "Could not reach Supabase.") from error

    try:
        body = response.json() if response.content else {}
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}
    if not response.is_success:
        detail = body.get("msg") or body.get("message") or body.get("error_description")
        raise SupabaseRequestError(
            response.status_code,
            str(detail or "Supabase rejected the request."),
        )
    return body


def create_auth_user(email: str, password: str) -> dict:
    service_key = _setting("SUPABASE_SERVICE_ROLE_KEY")
    return _request(
        "POST",
        "/auth/v1/admin/users",
        api_key=service_key,
        bearer=service_key,
        json_body={"email": email, "password": password, "email_confirm": True},
    )


def delete_auth_user(user_id: str) -> None:
    service_key = _setting("SUPABASE_SERVICE_ROLE_KEY")
    _request(
        "DELETE",
        f"/auth/v1/admin/users/{quote(user_id, safe='')}",
        api_key=service_key,
        bearer=service_key,
    )


def sign_in_with_password(email: str, password: str) -> dict:
    return _request(
        "POST",
        "/auth/v1/token?grant_type=password",
        api_key=_setting("SUPABASE_PUBLISHABLE_KEY"),
        json_body={"email": email, "password": password},
    )


def refresh_auth_session(refresh_token: str) -> dict:
    return _request(
        "POST",
        "/auth/v1/token?grant_type=refresh_token",
        api_key=_setting("SUPABASE_PUBLISHABLE_KEY"),
        json_body={"refresh_token": refresh_token},
    )


def sign_out(access_token: str) -> None:
    _request(
        "POST",
        "/auth/v1/logout",
        api_key=_setting("SUPABASE_PUBLISHABLE_KEY"),
        bearer=access_token,
    )


@lru_cache(maxsize=1)
def _jwks_client() -> PyJWKClient:
    return PyJWKClient(f"{_project_url()}/auth/v1/.well-known/jwks.json")


def verify_access_token(access_token: str) -> dict:
    project_url = _project_url()
    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(access_token)
        return jwt.decode(
            access_token,
            signing_key.key,
            algorithms=["ES256"],
            audience="authenticated",
            issuer=f"{project_url}/auth/v1",
        )
    except PyJWKClientError as error:
        raise SupabaseRequestError(502, "Could not retrieve Supabase signing keys.") from error
    except PyJWTError as error:
        raise ValueError("Invalid or expired Supabase access token.") from error


def upload_storage_object(
    bucket: str,
    path: str,
    content: bytes,
    media_type: str,
    *,
    upsert: bool = False,
) -> None:
    service_key = _setting("SUPABASE_SERVICE_ROLE_KEY")
    _request(
        "POST",
        f"/storage/v1/object/{quote(bucket, safe='')}/{quote(path, safe='/')}",
        api_key=service_key,
        bearer=service_key,
        content=content,
        content_type=media_type,
        extra_headers={"x-upsert": str(upsert).lower()},
    )


def delete_storage_objects(bucket: str, paths: list[str]) -> None:
    if not paths:
        return
    service_key = _setting("SUPABASE_SERVICE_ROLE_KEY")
    _request(
        "DELETE",
        f"/storage/v1/object/{quote(bucket, safe='')}",
        api_key=service_key,
        bearer=service_key,
        json_body={"prefixes": paths},
    )


def create_signed_storage_url(bucket: str, path: str, expires_in: int = 3600) -> str:
    service_key = _setting("SUPABASE_SERVICE_ROLE_KEY")
    result = _request(
        "POST",
        f"/storage/v1/object/sign/{quote(bucket, safe='')}/{quote(path, safe='/')}",
        api_key=service_key,
        bearer=service_key,
        json_body={"expiresIn": expires_in},
    )
    signed_url = result.get("signedURL")
    if not isinstance(signed_url, str) or not signed_url:
        raise SupabaseRequestError(502, "Supabase did not return a signed storage URL.")
    if signed_url.startswith("http://") or signed_url.startswith("https://"):
        return signed_url
    return f"{_project_url()}/storage/v1{signed_url}"
