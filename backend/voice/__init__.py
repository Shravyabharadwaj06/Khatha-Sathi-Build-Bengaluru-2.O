"""Voice assistant for Khatha Sathi (docs/VOICE_CONTRACT.md).

  providers.py  speech-to-text / text-to-speech (Gnani or mock), one-call-at-a-time lock, errors
  parser.py     rule-based understanding of Hindi / Kannada / English / mixed text (always available)
  llm.py        optional LLM intent parser (OpenAI-compatible), validated, falls back to rules
  templates.py  reply texts in hi / kn / en, filled only with database values
  store.py      database access for the assistant (always scoped to one shop)
  service.py    the flow: command -> draft / clarify / answer, confirm, cancel, undo, speak, usage
  router.py     FastAPI endpoints /voice/*
"""
