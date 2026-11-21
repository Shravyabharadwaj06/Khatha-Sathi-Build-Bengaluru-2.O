import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePageStyles } from '../hooks/usePageStyles';
import { useToast } from '../hooks/useToast';
import { getSession } from '../services/session';
import { createIssueReport } from '../services/api';
import reportCss from '../styles/report.css?raw';

const CATEGORIES = [
  { id: 'login', label: 'Login', icon: 'key' },
  { id: 'voice', label: 'Voice & Lang', icon: 'mic' },
  { id: 'stock', label: 'Stock / Items', icon: 'inventory_2' },
  { id: 'customers', label: 'Customers', icon: 'groups' },
  { id: 'bills', label: 'Bills / Khata', icon: 'receipt_long' },
  { id: 'upi', label: 'UPI Payment', icon: 'qr_code_2' },
  { id: 'slow', label: 'Slow / Stuck', icon: 'speed' },
  { id: 'other', label: 'Other Issue', icon: 'chat' },
] as const;

interface SpeechRecognitionResult {
  transcript: string;
}

interface SpeechRecognitionEvent {
  results: ArrayLike<ArrayLike<SpeechRecognitionResult>>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export default function ReportIssue() {
  usePageStyles({ css: [reportCss], bodyClass: 'report-body', title: 'CHOTU.ai | Report an issue' });

  const navigate = useNavigate();
  const session = getSession();
  const { text: toastText, show: toastShow, showToast } = useToast();
  const [categories, setCategories] = useState<string[]>(['voice']);
  const [description, setDescription] = useState('');
  const [contactAllowed, setContactAllowed] = useState(true);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const urls = attachments.map((file) => URL.createObjectURL(file));
    setAttachmentUrls(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [attachments]);

  const toggleCategory = (categoryId: string) => {
    setCategories((selected) =>
      selected.includes(categoryId) ? selected.filter((item) => item !== categoryId) : [...selected, categoryId],
    );
    setFormError('');
  };

  const addAttachments = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const next = [...attachments];
    for (const file of selected) {
      if (!file.type.startsWith('image/')) {
        showToast(`${file.name} is not an image.`);
      } else if (file.size > 8 * 1024 * 1024) {
        showToast(`${file.name} is larger than 8 MB.`);
      } else if (next.length >= 2) {
        showToast('You can attach up to 2 photos.');
        break;
      } else {
        next.push(file);
      }
    }
    setAttachments(next);
    event.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const toggleRecording = () => {
    if (recognition.current) {
      recognition.current.stop();
      recognition.current = null;
      setIsRecording(false);
      return;
    }

    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast('Voice typing is not available in this browser. You can type your report instead.');
      return;
    }

    const recorder = new SpeechRecognition();
    recorder.lang = 'en-IN';
    recorder.interimResults = false;
    recorder.maxAlternatives = 1;
    recorder.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? '').join(' ').trim();
      if (transcript) {
        setDescription((current) => [current.trim(), transcript].filter(Boolean).join(' '));
        setFormError('');
      }
    };
    recorder.onerror = (event) => {
      setIsRecording(false);
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        showToast('Microphone access was not available. Please type your report.');
      }
    };
    recorder.onend = () => {
      recognition.current = null;
      setIsRecording(false);
    };
    try {
      recorder.start();
      recognition.current = recorder;
      setIsRecording(true);
    } catch {
      showToast('Could not start voice typing. Please type your report.');
    }
  };

  const listenToInstructions = () => {
    if (!('speechSynthesis' in window)) {
      showToast('Audio instructions are not available in this browser.');
      return;
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(
      new SpeechSynthesisUtterance('Choose what went wrong, describe the issue, and send your report.'),
    );
  };

  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (categories.length === 0) {
      setFormError('Choose at least one issue type.');
      return;
    }
    if (!description.trim()) {
      setFormError('Tell us what happened so we can help.');
      return;
    }

    setIsSubmitting(true);
    setFormError('');
    try {
      const report = await createIssueReport({
        categories,
        description: description.trim(),
        contactAllowed,
        attachments,
      });
      navigate('/report-sent', { replace: true, state: { report } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Your report could not be sent. Please try again.';
      setFormError(message);
      showToast(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const shopName = session?.user.shopName || 'Lakshmi Provisions';
  const ownerName = session?.user.name || 'Ramesh Kumar';
  const rawPhone = session?.user.phone.replace(/\D/g, '') ?? '9845123456';
  const formattedPhone = rawPhone.length === 10 ? `+91 ${rawPhone.slice(0, 5)} ${rawPhone.slice(5)}` : `+91 ${rawPhone}`;

  return (
    <div className="report-page">
      <header className="report-header">
        <button className="report-back" type="button" aria-label="Back to shop" onClick={() => navigate('/home')}>
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
        </button>
        <h1>Voice Counter</h1>
        <div className="report-header-tools">
          <span className="report-language">EN / HI</span>
          <button className="report-profile" type="button" aria-label="My profile" onClick={() => navigate('/profile')}>
            <span className="material-symbols-outlined" aria-hidden="true">person</span>
          </button>
        </div>
      </header>

      <main className="report-main">
        <section className="screen-listen" aria-label="Screen instructions">
          <button className="listen-button" type="button" aria-label="Listen to screen instructions" onClick={listenToInstructions}>
            <span className="material-symbols-outlined" aria-hidden="true">volume_up</span>
          </button>
          <div className="listen-copy">
            <strong>Listen to screen</strong>
            <span>ಕನ್ನಡ • हिन्दी • English</span>
          </div>
          <button className="listen-text-button" type="button" onClick={listenToInstructions}>Tap to hear</button>
        </section>

        <p className="report-intro">Tell us what went wrong. It takes less than a minute.</p>

        <form onSubmit={submitReport} noValidate>
          <section className="report-section" aria-labelledby="category-title">
            <div className="section-heading">
              <h2 id="category-title">What is the problem about?</h2>
              <span>{categories.length} of 8 selected</span>
            </div>
            <div className="category-grid">
              {CATEGORIES.map((category) => {
                const selected = categories.includes(category.id);
                return (
                  <button
                    className={`category-button${selected ? ' selected' : ''}`}
                    key={category.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleCategory(category.id)}
                  >
                    <span className="material-symbols-outlined category-icon" aria-hidden="true">{category.icon}</span>
                    <span>{category.label}</span>
                    {selected && <span className="material-symbols-outlined category-check" aria-hidden="true">check_circle</span>}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="report-section" aria-labelledby="description-title">
            <div className="section-heading">
              <h2 id="description-title">Tell us what happened</h2>
              <span className="fastest-badge">Fastest</span>
            </div>
            <div className="description-card">
              <label className="sr-only" htmlFor="issue-description">Describe what went wrong</label>
              <textarea
                id="issue-description"
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setFormError('');
                }}
                placeholder="Example: Bill did not send to Ravi after speaking in Kannada."
                rows={3}
                maxLength={1000}
                aria-describedby={formError ? 'report-error' : undefined}
              />
              <div className="voice-note-row">
                <div>
                  <strong>Voice note</strong>
                  <span>Tap round mic &amp; speak naturally</span>
                </div>
                <button
                  className={`record-button${isRecording ? ' recording' : ''}`}
                  type="button"
                  aria-label={isRecording ? 'Stop voice typing' : 'Tap and speak issue'}
                  aria-pressed={isRecording}
                  onClick={toggleRecording}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">{isRecording ? 'stop' : 'mic'}</span>
                  <span>{isRecording ? 'STOP' : 'SPEAK'}</span>
                </button>
              </div>
            </div>
            <p className="language-hint">
              <span className="material-symbols-outlined" aria-hidden="true">translate</span>
              You can speak in <strong>ಕನ್ನಡ, हिन्दी or English.</strong>
            </p>
          </section>

          <section className="report-section" aria-labelledby="photo-title">
            <div className="section-heading">
              <h2 id="photo-title">Add a photo <span>(optional)</span></h2>
              <span>{attachments.length} of 2</span>
            </div>
            <div className="photo-actions">
              <button type="button" className="photo-action" onClick={() => cameraInput.current?.click()}>
                <span className="material-symbols-outlined" aria-hidden="true">photo_camera</span>
                <span>Take photo</span>
              </button>
              <button type="button" className="photo-action" onClick={() => galleryInput.current?.click()}>
                <span className="material-symbols-outlined" aria-hidden="true">image</span>
                <span>Gallery</span>
              </button>
              <button
                type="button"
                className="photo-action add-photo"
                onClick={() => galleryInput.current?.click()}
                disabled={attachments.length >= 2}
              >
                <span className="material-symbols-outlined" aria-hidden="true">add_photo_alternate</span>
                <span>+ Add</span>
              </button>
            </div>
            {attachments.length > 0 && (
              <ul className="attachment-list" aria-label="Attached photos">
                {attachments.map((file, index) => (
                  <li key={`${file.name}-${index}`}>
                    <img src={attachmentUrls[index]} alt="" />
                    <span title={file.name}>{file.name}</span>
                    <button type="button" aria-label={`Remove ${file.name}`} onClick={() => removeAttachment(index)}>
                      <span className="material-symbols-outlined" aria-hidden="true">close</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input ref={cameraInput} className="sr-only" type="file" accept="image/*" capture="environment" aria-label="Take an issue photo" onChange={addAttachments} />
            <input ref={galleryInput} className="sr-only" type="file" accept="image/*" multiple aria-label="Choose photos from gallery" onChange={addAttachments} />
          </section>

          <section className="report-section" aria-labelledby="contact-title">
            <div className="section-heading">
              <h2 id="contact-title">Can we contact you?</h2>
            </div>
            <div className="contact-card">
              <label className="contact-toggle-row" htmlFor="contact-allowed">
                <span>
                  <strong>OK to call or WhatsApp me</strong>
                  <small>We only contact if we need more details</small>
                </span>
                <span className="switch">
                  <input
                    id="contact-allowed"
                    type="checkbox"
                    checked={contactAllowed}
                    onChange={(event) => setContactAllowed(event.target.checked)}
                  />
                  <span aria-hidden="true" />
                </span>
              </label>
              <div className={`contact-details${contactAllowed ? '' : ' contact-muted'}`}>
                <div>
                  <strong>{formattedPhone}</strong>
                  <span className="material-symbols-outlined verified-icon" aria-label="Verified number">verified</span>
                  <small>{ownerName} • {shopName}</small>
                </div>
                <span className="primary-badge">Primary</span>
              </div>
            </div>
          </section>

          <aside className="diagnostics-note">
            <span className="material-symbols-outlined" aria-hidden="true">lock</span>
            <div>
              <strong>Auto-diagnostics included</strong>
              <p>App details like your phone model and app version (v2.4) are sent automatically. Only the verified Chotu support team can see this.</p>
            </div>
          </aside>

          {formError && <p className="report-error" id="report-error" role="alert">{formError}</p>}

          <div className="report-actions">
            <button className="send-report-button" type="submit" disabled={isSubmitting}>
              <span>{isSubmitting ? 'Sending report…' : 'Send report'}</span>
              <span className="material-symbols-outlined" aria-hidden="true">{isSubmitting ? 'progress_activity' : 'arrow_forward'}</span>
            </button>
            <button className="cancel-report-button" type="button" onClick={() => navigate('/home')}>Cancel</button>
          </div>
        </form>
      </main>

      <div className={`report-toast${toastShow ? ' visible' : ''}`} role="status" aria-live="polite">{toastText}</div>
    </div>
  );
}
