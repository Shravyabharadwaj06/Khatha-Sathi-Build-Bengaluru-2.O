/**
 * Browser-only speech (no Gnani credits):
 * - recognition with the Web Speech API (Chrome/Edge/Android: webkitSpeechRecognition), used when
 *   VITE_VOICE_INPUT=browser or when the backend says Gnani is busy/down/over the daily limit;
 * - speechSynthesis, used when /voice/speak fails or in mock mode.
 */
import { ApiError } from './errors';
import type { VoiceLanguage } from '../types/voice';

interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function isBrowserRecognitionSupported(): boolean {
  return typeof window !== 'undefined' && !!recognitionCtor();
}

export interface BrowserRecognitionSession {
  stop(): void;
  cancel(): void;
  /** The final text. Rejects with EMPTY_AUDIO if nothing was recognised. */
  result: Promise<string>;
}

export function startBrowserRecognition(language: VoiceLanguage, onPartial?: (text: string) => void): BrowserRecognitionSession {
  const Ctor = recognitionCtor();
  if (!Ctor) throw new ApiError('This browser has no speech recognition.', undefined, 'MIC_UNSUPPORTED');
  const rec = new Ctor();
  rec.lang = language;
  rec.interimResults = true;
  rec.continuous = true;
  rec.maxAlternatives = 1;
  let finalText = '';
  let cancelled = false;

  const result = new Promise<string>((resolve, reject) => {
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += `${r[0].transcript} `;
        else interim += r[0].transcript;
      }
      onPartial?.(`${finalText}${interim}`.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
        reject(new ApiError('Microphone permission was denied.', undefined, 'MIC_DENIED'));
      else if (e.error === 'network') reject(new ApiError('Browser speech needs an internet connection.', undefined, 'NETWORK'));
    };
    rec.onend = () => {
      if (cancelled) return reject(new ApiError('Cancelled.', undefined, 'CANCELLED'));
      const text = finalText.trim();
      if (text) resolve(text);
      else reject(new ApiError("I didn't hear anything.", undefined, 'EMPTY_AUDIO'));
    };
  });
  rec.start();
  return {
    stop: () => rec.stop(),
    cancel: () => {
      cancelled = true;
      rec.abort();
    },
    result,
  };
}

/** Speak with the browser's own voice. Returns false if the browser cannot speak. */
export function speakWithBrowser(text: string, language: VoiceLanguage, volume = 1, rate = 1): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = language;
  u.volume = volume;
  u.rate = rate;
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang === language) ?? window.speechSynthesis.getVoices().find((v) => v.lang.startsWith(language.slice(0, 2)));
  if (voice) u.voice = voice;
  window.speechSynthesis.speak(u);
  return true;
}

export function stopBrowserSpeech(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}
