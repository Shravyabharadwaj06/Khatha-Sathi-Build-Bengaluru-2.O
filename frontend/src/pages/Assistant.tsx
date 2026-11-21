import { useCallback, useEffect, useReducer, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import assistantCss from '../styles/assistant.css?raw';
import { usePageStyles } from '../hooks/usePageStyles';
import { initialState, reducer, type Card } from '../components/assistant/assistantState';
import { AnswerCard, CancelledCard, ClarifyCard, DraftCard, ErrorCard, HeardCard, SavedCard } from '../components/assistant/AssistantCards';
import { ApiError, VOICE_INPUT_MODE, voiceCancel, voiceChoose, voiceCommand, voiceConfirm, voiceSpeak, voiceUndo } from '../services/api';
import { clearSession } from '../services/session';
import { MAX_CLIP_SECONDS, isRecordingSupported, startRecording } from '../services/recorder';
import { isBrowserRecognitionSupported, speakWithBrowser, startBrowserRecognition, stopBrowserSpeech } from '../services/browserSpeech';
import type { VoiceCommandInput, VoiceLanguage, VoiceResponse } from '../types/voice';

const LANGUAGES: { code: VoiceLanguage; label: string }[] = [
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'kn-IN', label: 'Kannada' },
  { code: 'en-IN', label: 'English' },
];

const EXAMPLES = [
  'Ravi ge 2 milk add maadu',
  'Ramesh ka kitna baaki hai?',
  'Ramesh ka hisaab samjhao',
  'Ramesh ko reminder bhejo',
  'Ramesh ne 200 diye',
  'Add Tata Salt 1 kg',
];

const STORE = { language: 'chotu.voice.language', muted: 'chotu.voice.muted', micIntro: 'chotu.voice.micIntroSeen' };
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
};

const FALLBACK_CODES = new Set(['GNANI_UNAVAILABLE', 'GNANI_TIMEOUT', 'DAILY_LIMIT_REACHED', 'UNSUPPORTED_AUDIO', 'MIC_UNSUPPORTED']);

interface ListeningSession {
  stop(): void;
  cancel(): void;
}

const formatClock = (s: number) => `0:${String(Math.ceil(s)).padStart(2, '0')}`;

export default function Assistant() {
  usePageStyles({ css: [assistantCss], title: 'CHOTU.ai | Assistant' });
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [language, setLanguage] = useState<VoiceLanguage>(() => {
    const saved = read(STORE.language);
    return LANGUAGES.some((l) => l.code === saved) ? (saved as VoiceLanguage) : 'hi-IN';
  });
  const [muted, setMuted] = useState(() => read(STORE.muted) === '1');
  const [inputMode, setInputMode] = useState<'gnani' | 'browser'>(VOICE_INPUT_MODE);
  const [showText, setShowText] = useState(false);
  const [text, setText] = useState('');
  const [showMicIntro, setShowMicIntro] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const stateRef = useRef(state);
  stateRef.current = state;
  const languageRef = useRef(language);
  languageRef.current = language;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const session = useRef<ListeningSession | null>(null);
  const lastRequest = useRef<VoiceCommandInput | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const feedEnd = useRef<HTMLDivElement>(null);
  const textInput = useRef<HTMLInputElement>(null);

  const busy = state.phase === 'sending' || state.phase === 'saving';
  const recording = state.phase === 'recording';
  const canBrowserVoice = isBrowserRecognitionSupported();

  useEffect(() => write(STORE.language, language), [language]);
  useEffect(() => write(STORE.muted, muted ? '1' : '0'), [muted]);

  // ---------------------------------------------------------------- speaking
  const stopPlayback = useCallback(() => {
    player.current?.pause();
    player.current = null;
    stopBrowserSpeech();
  }, []);

  const speak = useCallback(
    async (reply: string, lang: VoiceLanguage) => {
      if (!reply || mutedRef.current) return;
      stopPlayback();
      try {
        const blob = await voiceSpeak(reply, lang);
        if (mutedRef.current) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.addEventListener('ended', () => URL.revokeObjectURL(url));
        player.current = audio;
        await audio.play();
      } catch {
        if (!mutedRef.current) speakWithBrowser(reply, lang);
      }
    },
    [stopPlayback],
  );

  useEffect(() => {
    if (muted) stopPlayback();
  }, [muted, stopPlayback]);

  // ---------------------------------------------------------------- errors
  const handleError = useCallback((e: unknown) => {
    const err = e instanceof ApiError ? e : null;
    const code = err?.code ?? 'INTERNAL';
    if (code === 'CANCELLED') return dispatch({ type: 'RECORD_ABORT' });
    if (code === 'MIC_UNSUPPORTED' && !isBrowserRecognitionSupported()) setShowText(true);
    dispatch({ type: 'ERROR', code, message: err?.message ?? 'Something went wrong.' });
  }, []);

  // ---------------------------------------------------------------- sending
  const send = useCallback(
    async (input: Omit<VoiceCommandInput, 'draftId' | 'language'>) => {
      const request: VoiceCommandInput = { ...input, language: languageRef.current, draftId: stateRef.current.activeDraftId ?? undefined };
      lastRequest.current = request;
      dispatch({ type: 'SEND_START' });
      try {
        const response: VoiceResponse = await voiceCommand(request);
        dispatch({ type: 'RESPONSE', response, showHeard: true });
        void speak(response.reply_text, response.language ?? request.language);
      } catch (e) {
        handleError(e);
      }
    },
    [handleError, speak],
  );

  const retry = useCallback(() => {
    const last = lastRequest.current;
    if (last) void send({ audio: last.audio, text: last.text });
  }, [send]);

  // ---------------------------------------------------------------- listening
  const setLevel = (level: number) => dockRef.current?.style.setProperty('--va-level', level.toFixed(3));

  const listenWithGnani = useCallback(async () => {
    stopPlayback();
    dispatch({ type: 'RECORD_START', seconds: MAX_CLIP_SECONDS });
    try {
      const rec = await startRecording({ onLevel: setLevel, onTick: (s) => dispatch({ type: 'TICK', secondsLeft: s }) });
      session.current = rec;
      const { blob } = await rec.result;
      session.current = null;
      setLevel(0);
      await send({ audio: blob });
    } catch (e) {
      session.current = null;
      setLevel(0);
      handleError(e);
    }
  }, [handleError, send, stopPlayback]);

  const listenWithBrowser = useCallback(async () => {
    stopPlayback();
    dispatch({ type: 'RECORD_START', seconds: MAX_CLIP_SECONDS });
    const started = Date.now();
    let ticker: ReturnType<typeof setInterval> | undefined;
    let autoStop: ReturnType<typeof setTimeout> | undefined;
    try {
      const rec = startBrowserRecognition(languageRef.current, (partial) => dispatch({ type: 'PARTIAL', text: partial }));
      session.current = rec;
      ticker = setInterval(() => dispatch({ type: 'TICK', secondsLeft: Math.max(0, MAX_CLIP_SECONDS - (Date.now() - started) / 1000) }), 200);
      autoStop = setTimeout(() => rec.stop(), MAX_CLIP_SECONDS * 1000);
      const heard = await rec.result;
      clearInterval(ticker);
      clearTimeout(autoStop);
      session.current = null;
      await send({ text: heard });
    } catch (e) {
      clearInterval(ticker);
      clearTimeout(autoStop);
      session.current = null;
      handleError(e);
    }
  }, [handleError, send, stopPlayback]);

  const toggleMic = useCallback(() => {
    const phase = stateRef.current.phase;
    if (phase === 'recording') {
      session.current?.stop();
      return;
    }
    if (phase === 'sending' || phase === 'saving') return;
    if (inputMode === 'browser') {
      void listenWithBrowser();
      return;
    }
    if (!isRecordingSupported()) {
      handleError(new ApiError('This browser cannot record audio.', undefined, 'MIC_UNSUPPORTED'));
      return;
    }
    if (read(STORE.micIntro) !== '1') {
      setShowMicIntro(true);
      return;
    }
    void listenWithGnani();
  }, [handleError, inputMode, listenWithBrowser, listenWithGnani]);

  const allowMic = () => {
    write(STORE.micIntro, '1');
    setShowMicIntro(false);
    void listenWithGnani();
  };

  const switchToBrowserVoice = () => {
    setInputMode('browser');
    void listenWithBrowser();
  };

  const openTextBox = () => {
    setShowText(true);
    setShowMicIntro(false);
    requestAnimationFrame(() => textInput.current?.focus());
  };

  // Space bar toggles the mic when focus is not on a control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && el.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      toggleMic();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleMic]);

  // Stop everything when leaving the page.
  useEffect(
    () => () => {
      session.current?.cancel();
      stopPlayback();
    },
    [stopPlayback],
  );

  // ---------------------------------------------------------------- card actions
  const choose = async (card: Extract<Card, { kind: 'clarify' }>, optionId: string, label: string) => {
    dispatch({ type: 'SEND_START' });
    try {
      const response = await voiceChoose(card.clarify.clarify_id, optionId);
      dispatch({ type: 'RESPONSE', response, showHeard: false, clarifyCardId: card.id, chosenLabel: label });
      void speak(response.reply_text, response.language ?? language);
    } catch (e) {
      handleError(e);
    }
  };

  const confirm = async (card: Extract<Card, { kind: 'draft' }>) => {
    dispatch({ type: 'CONFIRM_START', cardId: card.id });
    try {
      const result = await voiceConfirm(card.draft.draft_id);
      dispatch({ type: 'CONFIRM_DONE', cardId: card.id, result });
      void speak(result.reply_text, language);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      const code = err?.code ?? 'INTERNAL';
      dispatch({
        type: 'CONFIRM_FAILED',
        cardId: card.id,
        code,
        message: err?.message ?? 'Could not save.',
        expired: code === 'DRAFT_EXPIRED' || code === 'DRAFT_NOT_FOUND' || code === 'DRAFT_NOT_PENDING',
      });
    }
  };

  const cancel = async (card: Extract<Card, { kind: 'draft' }>) => {
    try {
      await voiceCancel(card.draft.draft_id);
    } catch {
      /* the draft expires on the server anyway */
    }
    dispatch({ type: 'CANCEL_DONE', cardId: card.id });
  };

  const undo = async (card: Extract<Card, { kind: 'saved' }>) => {
    if (!card.result.entry_id) return;
    dispatch({ type: 'UNDO_START', cardId: card.id });
    try {
      const response = await voiceUndo(card.result.entry_id, language);
      dispatch({ type: 'RESPONSE', response, showHeard: false });
      void speak(response.reply_text, response.language ?? language);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      dispatch({ type: 'UNDO_FAILED', cardId: card.id, code: err?.code ?? 'INTERNAL', message: err?.message ?? 'Could not undo.' });
    }
  };

  const submitText = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setText('');
    void send({ text: value });
  };

  const goLogin = () => {
    clearSession();
    navigate('/login', { replace: true });
  };

  // ---------------------------------------------------------------- effects: expiry clock + scrolling
  const hasOpenDraft = state.cards.some((c) => c.kind === 'draft' && c.state === 'open');
  useEffect(() => {
    if (!hasOpenDraft) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasOpenDraft]);

  useEffect(() => {
    for (const c of state.cards) {
      if (c.kind === 'draft' && c.state === 'open' && Date.parse(c.draft.expires_at) <= now) dispatch({ type: 'DRAFT_EXPIRED', cardId: c.id });
    }
  }, [now, state.cards]);

  useEffect(() => {
    if (!state.cards.length) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    feedEnd.current?.scrollIntoView({ block: 'end', behavior: reduce ? 'auto' : 'smooth' });
  }, [state.cards.length]);

  // ---------------------------------------------------------------- render
  const status = (() => {
    switch (state.phase) {
      case 'recording':
        return inputMode === 'browser' ? 'Listening (browser voice)… tap to stop' : 'Listening… tap to stop';
      case 'sending':
        return 'Chotu is thinking…';
      case 'saving':
        return 'Saving…';
      case 'clarify':
        return 'Choose an option above, or speak again';
      case 'confirming':
        return 'Check the bill above: Confirm, Edit or Cancel';
      case 'saved':
        return 'Saved. Tap the mic for the next one';
      default:
        return 'Tap the mic and speak';
    }
  })();

  const renderCard = (card: Card) => {
    switch (card.kind) {
      case 'heard':
        return <HeardCard key={card.id} text={card.text} onRetry={toggleMic} disabled={busy || recording} />;
      case 'clarify':
        return <ClarifyCard key={card.id} card={card} disabled={busy || recording} onChoose={(id, label) => void choose(card, id, label)} />;
      case 'draft':
        return (
          <DraftCard
            key={card.id}
            card={card}
            now={now}
            busy={busy || recording}
            onConfirm={() => void confirm(card)}
            onEdit={toggleMic}
            onCancel={() => void cancel(card)}
          />
        );
      case 'saved':
        return <SavedCard key={card.id} card={card} busy={busy || recording} onUndo={() => void undo(card)} />;
      case 'answer':
        return <AnswerCard key={card.id} card={card} onTone={(tone) => dispatch({ type: 'SET_TONE', cardId: card.id, tone })} />;
      case 'cancelled':
        return <CancelledCard key={card.id} />;
      case 'error':
        return (
          <ErrorCard
            key={card.id}
            card={card}
            busy={busy || recording}
            canBrowserVoice={canBrowserVoice && inputMode !== 'browser'}
            examples={EXAMPLES}
            onRetry={lastRequest.current ? retry : null}
            onBrowserVoice={switchToBrowserVoice}
            onType={openTextBox}
            onExample={(t) => void send({ text: t })}
            onLogin={goLogin}
          />
        );
    }
  };

  const lastError = [...state.cards].reverse().find((c) => c.kind === 'error');
  const offerFallbackInDock = !!lastError && lastError.kind === 'error' && FALLBACK_CODES.has(lastError.code) && state.phase === 'error';

  return (
    <div className="va">
      <header className="va-top">
        <div className="va-title">
          <h1>Chotu</h1>
          <p>{inputMode === 'browser' ? 'Browser voice' : 'Voice assistant'}</p>
        </div>
        <label className="va-lang">
          <span className="material-symbols-outlined" aria-hidden="true">
            translate
          </span>
          <span className="va-sr">Language</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value as VoiceLanguage)} disabled={recording} data-testid="language">
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="va-icon-btn"
          aria-pressed={muted}
          aria-label={muted ? 'Turn spoken replies on' : 'Mute spoken replies'}
          onClick={() => setMuted((m) => !m)}
          data-testid="mute"
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            {muted ? 'volume_off' : 'volume_up'}
          </span>
        </button>
      </header>

      <main className="va-feed" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation with Chotu">
        {state.cards.length === 0 && (
          <section className="va-welcome" aria-label="How to use Chotu">
            <p className="va-eyebrow">Voice khata</p>
            <h2>Namaste! Bill, udhaar, payments: just say it.</h2>
            <p>Speak in Hindi, Kannada or English, or mix them. Nothing is saved until you press Confirm.</p>
            <p className="va-eyebrow">Try saying</p>
            <div className="va-chips">
              {EXAMPLES.map((e) => (
                <button key={e} type="button" className="va-chip va-chip-lav va-chip-btn" onClick={() => void send({ text: e })} disabled={busy || recording} data-testid="example">
                  {e}
                </button>
              ))}
            </div>
          </section>
        )}
        {state.cards.map(renderCard)}
        <div ref={feedEnd} className="va-feed-end" />
      </main>

      <div className={`va-dock ${recording ? 'is-recording' : ''}`} ref={dockRef}>
        {showMicIntro && (
          <section className="va-intro" role="dialog" aria-modal="false" aria-labelledby="va-intro-title" data-testid="mic-intro">
            <h2 id="va-intro-title">Chotu needs your microphone</h2>
            <p>Your browser will ask for permission. Chotu listens only while the mic button is on (up to 15 seconds).</p>
            <p className="va-privacy">
              <span className="material-symbols-outlined" aria-hidden="true">
                lock
              </span>
              Your voice is only used to understand the request and is not stored.
            </p>
            <div className="va-actions">
              <button type="button" className="va-btn va-btn-primary" onClick={allowMic} data-testid="allow-mic">
                Allow microphone
              </button>
              <button type="button" className="va-btn va-btn-outline" onClick={openTextBox}>
                Type instead
              </button>
            </div>
          </section>
        )}

        {recording && state.partialText && <p className="va-partial">“{state.partialText}”</p>}

        <div className="va-dock-row">
          <div className="va-dock-side">
            {recording ? (
              <div className="va-meter" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            ) : (
              <button type="button" className="va-link" onClick={() => (showText ? setShowText(false) : openTextBox())} data-testid="toggle-text">
                <span className="material-symbols-outlined" aria-hidden="true">
                  keyboard
                </span>
                {showText ? 'Hide' : 'Type'}
              </button>
            )}
          </div>

          <button
            type="button"
            className="va-mic"
            onClick={toggleMic}
            disabled={busy}
            aria-pressed={recording}
            aria-label={recording ? 'Stop and send' : 'Start speaking'}
            data-testid="mic"
          >
            <span className="va-mic-ring" aria-hidden="true" />
            <span className="material-symbols-outlined" aria-hidden="true">
              {recording ? 'stop' : busy ? 'hourglass_top' : 'mic'}
            </span>
          </button>

          <div className="va-dock-side va-dock-right">
            {recording ? (
              <span className="va-countdown" data-testid="countdown" aria-label={`${Math.ceil(state.secondsLeft)} seconds left`}>
                {formatClock(state.secondsLeft)}
              </span>
            ) : offerFallbackInDock && canBrowserVoice && inputMode !== 'browser' ? (
              <button type="button" className="va-link" onClick={switchToBrowserVoice}>
                Browser voice
              </button>
            ) : null}
          </div>
        </div>

        {recording && (
          <div className="va-progress" aria-hidden="true">
            <span style={{ width: `${(state.secondsLeft / MAX_CLIP_SECONDS) * 100}%` }} />
          </div>
        )}

        <p className="va-status" aria-live="polite" data-testid="status">
          {status}
        </p>

        {showText && (
          <form className="va-textform" onSubmit={submitText}>
            <label className="va-sr" htmlFor="va-text">
              Type your request
            </label>
            <input
              id="va-text"
              ref={textInput}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Ramesh ka kitna baaki hai?"
              autoComplete="off"
              maxLength={300}
              data-testid="text-input"
            />
            <button type="submit" className="va-btn va-btn-primary" disabled={busy || !text.trim()} data-testid="text-send">
              Send
            </button>
          </form>
        )}

        <p className="va-fineprint">Voice is only used to understand you and is not stored.</p>
      </div>
    </div>
  );
}
