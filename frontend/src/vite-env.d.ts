/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_MOCK_API?: string;
  readonly VITE_API_BASE_URL?: string;
  /** 'gnani' (default): send recorded audio to the backend. 'browser': use the browser's speech recognition and send text. */
  readonly VITE_VOICE_INPUT?: string;
  readonly VITE_INDICTRANS2_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
