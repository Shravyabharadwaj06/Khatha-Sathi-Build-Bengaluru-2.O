"""FastAPI endpoints /voice/* (docs/VOICE_CONTRACT.md). All need the Supabase login token and are
scoped to the user's shop. Errors use the contract shape: HTTP status + {"error": {"code", "message"}}."""
from typing import Callable, Optional

from fastapi import APIRouter, Depends, FastAPI, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from .config import load_settings
from .providers import VoiceError, check_clip
from .service import LANGUAGES, VoiceService
from .store import Ctx, Ledger, PostgresStore


class ChooseInput(BaseModel):
    clarify_id: str = Field(min_length=1, max_length=64)
    option_id: str = Field(min_length=1, max_length=64)


class DraftInput(BaseModel):
    draft_id: str = Field(min_length=1, max_length=64)


class UndoInput(BaseModel):
    entry_id: str = Field(min_length=1, max_length=64)
    language: str = "hi-IN"


class SpeakInput(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    language: str = "hi-IN"


def install_voice_errors(app: FastAPI) -> None:
    @app.exception_handler(VoiceError)
    async def _voice_error(_: Request, error: VoiceError):
        return JSONResponse(status_code=error.status, content={"error": {"code": error.code, "message": error.message}},
                            headers=error.headers)


def _language(value: Optional[str]) -> str:
    if value not in LANGUAGES:
        raise VoiceError(400, "BAD_REQUEST", "language must be hi-IN, kn-IN or en-IN.")
    return value


def create_voice_router(auth: Callable, db: Callable, ledger: Ledger) -> APIRouter:
    router = APIRouter(prefix="/voice", tags=["voice"])

    def get_store(session=Depends(db)):
        return PostgresStore(session, ledger)

    def service(context=Depends(auth), store=Depends(get_store)) -> VoiceService:
        return VoiceService(store=store, settings=load_settings(), ctx=Ctx(user_id=context.user_id, shop_id=context.shop_id))

    router.get_store = get_store  # tests replace this with an in-memory store

    @router.post("/command")
    def command(
        audio: Optional[UploadFile] = File(default=None),
        text: Optional[str] = Form(default=None),
        language: Optional[str] = Form(default=None),
        draft_id: Optional[str] = Form(default=None),
        svc: VoiceService = Depends(service),
    ):
        """Audio (WAV 16 kHz mono) or text -> draft / clarify / answer / error. Never saves anything."""
        lang = _language(language)
        clip = None
        if not (text and text.strip()):
            if audio is None:
                raise VoiceError(400, "BAD_REQUEST", "Send audio or text.")
            data = audio.file.read(svc.settings.max_upload_bytes + 1)
            clip = check_clip(data, audio.content_type, audio.filename, svc.settings)
        return svc.command(text=text, clip=clip, language=lang, draft_id=draft_id or None)

    @router.post("/choose")
    def choose(body: ChooseInput, svc: VoiceService = Depends(service)):
        return svc.choose(body.clarify_id, body.option_id)

    @router.post("/confirm")
    def confirm(body: DraftInput, svc: VoiceService = Depends(service)):
        """The ONLY call that saves: one database transaction through the normal write helpers."""
        return svc.confirm(body.draft_id)

    @router.post("/cancel")
    def cancel(body: DraftInput, svc: VoiceService = Depends(service)):
        return svc.cancel(body.draft_id)

    @router.post("/undo")
    def undo(body: UndoInput, svc: VoiceService = Depends(service)):
        """Returns a reversal DRAFT for a saved entry; it still needs /voice/confirm."""
        return svc.undo_draft(body.entry_id, _language(body.language))

    @router.post("/speak")
    def speak(body: SpeakInput, svc: VoiceService = Depends(service)):
        audio, content_type = svc.speak(body.text, _language(body.language))
        return Response(content=audio, media_type=content_type, headers={"Cache-Control": "no-store"})

    @router.get("/usage")
    def usage(svc: VoiceService = Depends(service)):
        return svc.usage()

    return router
