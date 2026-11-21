/**
 * Push-to-talk recorder for the voice assistant.
 * - Records with MediaRecorder (whatever the browser supports: webm/opus on Chrome, mp4 on Safari, ogg on Firefox).
 * - Stops by itself after MAX_CLIP_SECONDS.
 * - Converts the clip to WAV 16 kHz mono 16-bit PCM in the browser (Web Audio API), because Gnani's STT REST
 *   endpoint accepts WAV/MP3/OGG/FLAC/AAC/M4A but not WebM. See docs/VOICE_CONTRACT.md.
 * Audio is never stored: the Blob only lives in memory until it is uploaded.
 */
import { ApiError } from './errors';

export const MAX_CLIP_SECONDS = 15;
const TARGET_RATE = 16_000;
const GNANI_NATIVE_TYPES = ['audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/mpeg', 'audio/aac', 'audio/flac', 'audio/wav'];

export interface RecordingResult {
  /** WAV 16 kHz mono (or, rarely, the original clip if it could not be converted but Gnani accepts it). */
  blob: Blob;
  seconds: number;
}

export interface RecordingSession {
  /** Stop now and produce the clip. Safe to call more than once. */
  stop(): void;
  /** Stop and throw the audio away. */
  cancel(): void;
  /** Resolves when the clip is ready (after stop() or the automatic 15 s stop). Rejects on cancel/errors. */
  result: Promise<RecordingResult>;
}

interface StartOptions {
  maxSeconds?: number;
  /** 0..1 loudness, about 30 times a second. */
  onLevel?: (level: number) => void;
  /** Seconds left, updated about 5 times a second. */
  onTick?: (secondsLeft: number) => void;
}

type AudioContextCtor = typeof AudioContext;
const audioContextCtor = (): AudioContextCtor | undefined =>
  (window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }).AudioContext ??
  (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;

export function isRecordingSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
  return candidates.find((t) => MediaRecorder.isTypeSupported?.(t));
}

export async function startRecording({ maxSeconds = MAX_CLIP_SECONDS, onLevel, onTick }: StartOptions = {}): Promise<RecordingSession> {
  if (!isRecordingSupported()) throw new ApiError('This browser cannot record audio.', undefined, 'MIC_UNSUPPORTED');

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    throw new ApiError(denied ? 'Microphone permission was denied.' : 'No microphone was found.', undefined, denied ? 'MIC_DENIED' : 'MIC_UNSUPPORTED');
  }

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (ev) => {
    if (ev.data.size) chunks.push(ev.data);
  });

  // Loudness meter
  const Ctx = audioContextCtor();
  const levelCtx = Ctx ? new Ctx() : undefined;
  let raf = 0;
  if (levelCtx && onLevel) {
    const analyser = levelCtx.createAnalyser();
    analyser.fftSize = 512;
    levelCtx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  const startedAt = Date.now();
  const elapsed = () => Math.min(maxSeconds, (Date.now() - startedAt) / 1000);
  const ticker = setInterval(() => onTick?.(Math.max(0, maxSeconds - elapsed())), 200);
  onTick?.(maxSeconds);
  let cancelled = false;
  let stopped = false;

  const cleanup = () => {
    clearInterval(ticker);
    clearTimeout(autoStop);
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    void levelCtx?.close().catch(() => {});
  };

  const result = new Promise<RecordingResult>((resolve, reject) => {
    recorder.addEventListener('stop', async () => {
      const seconds = elapsed();
      cleanup();
      if (cancelled) return reject(new ApiError('Recording cancelled.', undefined, 'CANCELLED'));
      const clip = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
      if (!clip.size) return reject(new ApiError("I didn't hear anything.", undefined, 'EMPTY_AUDIO'));
      try {
        resolve({ blob: await toWav16kMono(clip), seconds });
      } catch (e) {
        reject(e);
      }
    });
    recorder.addEventListener('error', () => {
      cleanup();
      reject(new ApiError('Recording failed.', undefined, 'MIC_UNSUPPORTED'));
    });
  });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (recorder.state !== 'inactive') recorder.stop();
  };
  const autoStop = setTimeout(stop, maxSeconds * 1000);
  recorder.start(250);

  return {
    stop,
    cancel: () => {
      cancelled = true;
      stop();
    },
    result,
  };
}

/** Decode any recorded clip and re-encode it as WAV, 16 kHz, mono, 16-bit PCM. */
export async function toWav16kMono(clip: Blob): Promise<Blob> {
  const Ctx = audioContextCtor();
  try {
    if (!Ctx || typeof OfflineAudioContext === 'undefined') throw new Error('Web Audio not available');
    const ctx = new Ctx();
    try {
      const decoded = await ctx.decodeAudioData(await clip.arrayBuffer());
      const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
      const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination); // stereo is down-mixed to mono here
      source.start();
      const rendered = await offline.startRendering();
      return encodeWav(rendered.getChannelData(0), TARGET_RATE);
    } finally {
      void ctx.close().catch(() => {});
    }
  } catch {
    const type = clip.type.split(';')[0];
    if (GNANI_NATIVE_TYPES.includes(type)) return clip;
    throw new ApiError('This recording format is not supported.', undefined, 'UNSUPPORTED_AUDIO');
  }
}

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (const s of samples) {
    const v = Math.max(-1, Math.min(1, s));
    view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
