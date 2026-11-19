import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AUTH_BODY_CLASS, AUTH_CSS } from '../components/authPage';
import { AuthFooter } from '../components/AuthFooter';
import authHero from '../assets/auth-hero.png';
import { usePageStyles } from '../hooks/usePageStyles';
import { useRotator } from '../hooks/useRotator';
import { useToast } from '../hooks/useToast';
import { AuthToast } from '../components/AuthToast';
import { FieldError } from '../components/FieldError';
import { ApiError, login } from '../services/api';
import { saveSession } from '../services/session';
import { isEmail, isTenDigits } from '../utils/validation';


// Verbatim from the original script.
const welcomePhrases = [
  { text: 'Welcome', dir: 'ltr', lang: 'en' },
  { text: 'स्वागत है', dir: 'ltr', lang: 'hi' },
  { text: 'ಸ್ವಾಗತ', dir: 'ltr', lang: 'kn' },
  { text: 'வரவேற்கிறோம்', dir: 'ltr', lang: 'ta' },
  { text: 'స్వాగతం', dir: 'ltr', lang: 'te' },
  { text: 'സ്വാഗതം', dir: 'ltr', lang: 'ml' },
  { text: 'خوش آمدید', dir: 'rtl', lang: 'ur' },
  { text: 'স্বাগতম', dir: 'ltr', lang: 'bn' },
];

// Tab classes: the initial markup and the classes switchAuthMethod() assigns differ in the
// original (py-2/rounded-md vs py-space-xs/rounded). Reproduced as-is: see report.
const TAB_INITIAL_ACTIVE = 'flex-1 py-2 text-center font-label-md text-label-md uppercase tracking-wider rounded-md transition-all bg-primary-container text-on-primary font-bold shadow-sm';
const TAB_INITIAL_INACTIVE = 'flex-1 py-2 text-center font-label-md text-label-md uppercase tracking-wider rounded-md transition-all text-on-surface-variant hover:text-primary-container font-semibold';
const TAB_JS_ACTIVE = 'flex-1 py-space-xs text-center font-label-md text-label-md uppercase tracking-wider rounded transition-all bg-primary-container text-on-primary font-bold shadow-sm';
const TAB_JS_INACTIVE = 'flex-1 py-space-xs text-center font-label-md text-label-md uppercase tracking-wider rounded transition-all text-on-surface-variant hover:text-on-surface font-semibold';

const INPUT_BORDER = 'border-[#0F0F56]/20';
const withBorder = (cls: string, invalid: boolean) => (invalid ? cls.replace(INPUT_BORDER, 'border-error') : cls);

type Method = 'phone' | 'email';

/** Source: design-reference/log_in.html */
export default function Login() {
  usePageStyles({ css: AUTH_CSS, bodyClass: AUTH_BODY_CLASS, title: 'CHOTU.ai | Log in' });
  const navigate = useNavigate();
  const { text: toastText, show: toastShow, showToast } = useToast();

  // Original: span starts with opacity-0 and the first fade-out is a no-op, so "Welcome" is never shown.
  const { shown, visible } = useRotator({ length: welcomePhrases.length, intervalMs: 1300, swapDelayMs: 300, initialShown: 0, initialVisible: false });
  const phrase = welcomePhrases[shown];

  const [method, setMethod] = useState<Method>('phone');
  const [switched, setSwitched] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<{ identifier?: string; password?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  const switchAuthMethod = (m: Method) => {
    setMethod(m);
    setSwitched(true);
    setErrors({});
  };

  const isPhone = method === 'phone';
  const tabPhoneClass = switched ? (isPhone ? TAB_JS_ACTIVE : TAB_JS_INACTIVE) : TAB_INITIAL_ACTIVE;
  const tabEmailClass = switched ? (isPhone ? TAB_JS_INACTIVE : TAB_JS_ACTIVE) : TAB_INITIAL_INACTIVE;

  const identifierClass = `w-full bg-white border ${INPUT_BORDER} ${isPhone ? 'pl-12' : 'pl-space-md'} pr-4 py-2.5 rounded-lg font-body-md text-body-md text-on-surface placeholder:text-outline-variant focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-all`;
  const passwordClass = `w-full bg-white border ${INPUT_BORDER} px-4 py-2.5 pr-12 rounded-lg font-body-md text-body-md text-on-surface placeholder:text-outline-variant focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-all`;

  const hint = isPhone ? 'Enter your 10-digit registered WhatsApp or counter SIM number.' : 'Enter your official registered store or inventory email.';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const next: typeof errors = {};
    if (isPhone) {
      if (!identifier.trim()) next.identifier = 'Enter your mobile number.';
      else if (!isTenDigits(identifier)) next.identifier = 'Enter a valid 10-digit mobile number.';
    } else if (!identifier.trim()) next.identifier = 'Enter your email address.';
    else if (!isEmail(identifier)) next.identifier = 'Enter a valid email address.';
    if (!password) next.password = 'Enter your password or PIN.';
    setErrors(next);
    if (next.identifier || next.password) {
      document.getElementById(next.identifier ? 'identifier-input' : 'password-input')?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const session = await login({ method, identifier: isPhone ? identifier.replace(/\s/g, '') : identifier.trim(), password });
      saveSession(session, remember);
      navigate('/home', { replace: true });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
      setErrors(err instanceof ApiError && err.field === 'identifier' ? { identifier: message } : { password: message });
      setSubmitting(false);
    }
  };

  return (
    <>
      <header className="fixed top-0 w-full z-50 bg-surface/80 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
        <div className="h-16 max-w-7xl mx-auto px-margin lg:px-margin-desktop flex items-center justify-between">
          <div className="flex items-center gap-space-xs">
            <span className="font-headline-md text-headline-md text-primary tracking-tight uppercase">
              CHOTU<span className="text-primary-container font-headline-sm text-headline-sm">.ai</span>
            </span>
          </div>
          <Link className="flex items-center gap-space-xs font-label-md text-label-md uppercase tracking-wider text-on-surface-variant hover:text-on-surface transition-colors" data-path="landing-page" to="/">
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>Back to Home
          </Link>
        </div>
      </header>
      <main className="w-full flex-1 flex flex-col items-center justify-center pt-16 bg-surface px-margin lg:px-margin-desktop">
        <div className="flex flex-col w-full items-center justify-center py-space-md lg:py-space-xl">
          <div className="w-full max-w-5xl mx-auto bg-surface-container-lowest rounded-xl overflow-hidden flex flex-col md:flex-row shadow-[0_20px_50px_rgba(15,15,86,0.08)] border border-[#0F0F56]/10">
            {/* Left Hero & Multilingual Illustration Panel */}
            <div className="relative w-full md:w-1/2 min-h-[320px] md:min-h-[580px] bg-surface-container-low flex flex-col justify-between overflow-hidden">
              <img alt="CHOTU.ai Neighborhood Retailer Voice Assistant Illustration" className="absolute inset-0 w-full h-full object-cover object-center" src={authHero} />
              <div className="absolute inset-0 bg-primary-container/10 pointer-events-none"></div>
              <div className="relative z-10 m-space-md lg:m-space-lg flex flex-col gap-space-xs items-start">
                <div className="inline-flex items-center gap-space-sm bg-surface-container-lowest/95 backdrop-blur-md px-space-md py-space-xs rounded shadow-sm text-primary-container">
                  <span className="w-2 h-2 rounded-full bg-secondary-fixed animate-ping"></span>
                  <span className="font-label-sm text-label-sm uppercase tracking-widest text-on-surface-variant font-bold">Namaste • Welcome</span>
                  <span className="text-outline-variant font-body-sm text-body-sm">•</span>
                  <div className="relative h-6 min-w-[110px] flex items-center">
                    <span
                      className={`font-headline-sm text-headline-sm text-primary-container transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'} whitespace-nowrap`}
                      id="multilingual-text"
                      dir={phrase.dir}
                      lang={phrase.lang}
                    >
                      {phrase.text}
                    </span>
                  </div>
                </div>
              </div>
              <div className="relative z-10 m-space-md lg:m-space-lg mt-auto">
                <div className="bg-surface-container-lowest/95 backdrop-blur-md p-space-md rounded shadow-sm max-w-md">
                  <div className="flex items-center gap-space-xs mb-space-xs">
                    <span className="px-space-xs py-0.5 rounded-sm bg-secondary-fixed text-primary-container font-label-sm text-label-sm uppercase font-bold tracking-wider">Kirana AI</span>
                    <span className="font-label-md text-label-md text-primary-container font-bold">CHOTU.ai</span>
                  </div>
                  <p className="font-body-sm text-body-sm text-on-surface-variant leading-snug">Multilingual Voice Assistant for Neighborhood Retail • Seamless Ledger, Billing &amp; Khata</p>
                </div>
              </div>
            </div>
            {/* Right Interaction Panel: Login Form */}
            <div className="w-full md:w-1/2 p-space-md sm:p-space-lg lg:p-space-xl flex flex-col justify-between bg-surface-container-lowest">
              <div className="w-full">
                <div className="flex items-center justify-between gap-space-sm mb-space-sm">
                  <span className="font-label-sm text-label-sm uppercase tracking-widest text-on-surface-variant font-bold">Merchant Portal</span>
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#EDEA43] text-primary-container font-label-sm text-label-sm font-bold tracking-wider border border-[#0F0F56]/15">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#0F0F56]"></span>v2.4 LIVE
                  </span>
                </div>
                <h1 className="font-headline-lg text-headline-lg text-primary-container uppercase tracking-tight mb-space-xs">Welcome Back</h1>
                <p className="font-body-md text-body-md text-on-surface-variant mb-space-lg">Sign in to manage your shop&apos;s inventory, daily accounts, and live voice orders.</p>
                {/* Segmented Tab Selector */}
                <div className="w-full bg-[#C2DCE3]/30 p-1 rounded-lg border border-[#0F0F56]/10 flex items-center mb-space-lg">
                  <button className={tabPhoneClass} id="tab-phone" onClick={() => switchAuthMethod('phone')} type="button" aria-pressed={isPhone}>
                    Phone Number
                  </button>
                  <button className={tabEmailClass} id="tab-email" onClick={() => switchAuthMethod('email')} type="button" aria-pressed={!isPhone}>
                    Email ID
                  </button>
                </div>
                <form className="space-y-space-md" onSubmit={onSubmit} noValidate>
                  <div className="flex flex-col gap-space-xs">
                    <label className="font-label-md text-label-md uppercase text-on-surface-variant font-bold" htmlFor="identifier-input" id="identifier-label">
                      {isPhone ? 'Mobile Number' : 'Email Address'}
                    </label>
                    <div className="relative flex items-center">
                      <span className="absolute left-space-md font-body-md text-body-md text-on-surface-variant font-medium" id="phone-prefix" style={isPhone ? (switched ? { display: 'block' } : undefined) : { display: 'none' }}>
                        +91
                      </span>
                      <input
                        className={withBorder(identifierClass, !!errors.identifier)}
                        id="identifier-input"
                        inputMode={isPhone ? 'numeric' : 'email'}
                        placeholder={isPhone ? '98765 43210' : 'storeowner@chotu.shop'}
                        type={isPhone ? 'tel' : 'email'}
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        aria-invalid={errors.identifier ? true : undefined}
                        aria-describedby="identifier-hint"
                        autoComplete={isPhone ? 'tel-national' : 'email'}
                      />
                    </div>
                    <p className={`font-body-sm text-body-sm ${errors.identifier ? 'text-error' : 'text-on-surface-variant'}`} id="identifier-hint" role={errors.identifier ? 'alert' : undefined}>
                      {errors.identifier ?? hint}
                    </p>
                  </div>
                  <div className="flex flex-col gap-space-xs">
                    <div className="flex items-center justify-between">
                      <label className="font-label-md text-label-md uppercase text-on-surface-variant font-bold" htmlFor="password-input">
                        Password / Secure PIN
                      </label>
                    </div>
                    <div className="relative flex items-center">
                      <input
                        className={withBorder(passwordClass, !!errors.password)}
                        id="password-input"
                        placeholder="Enter password or 6-digit PIN"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        aria-invalid={errors.password ? true : undefined}
                        aria-describedby={errors.password ? 'password-error' : undefined}
                        autoComplete="current-password"
                      />
                      <button aria-label="Toggle password visibility" className="absolute right-space-sm p-1.5 text-on-surface-variant hover:text-primary-container transition-colors" id="password-toggle-btn" onClick={() => setShowPassword((s) => !s)} type="button">
                        <span className="material-symbols-outlined text-[20px]" id="password-toggle-icon">
                          {showPassword ? 'visibility_off' : 'visibility'}
                        </span>
                      </button>
                    </div>
                    <FieldError id="password-error" message={errors.password} />
                  </div>
                  <div className="flex items-center justify-between pt-space-xs">
                    <label className="flex items-center gap-space-xs cursor-pointer select-none">
                      <input checked={remember} onChange={(e) => setRemember(e.target.checked)} className="w-4 h-4 rounded-sm accent-primary-container cursor-pointer" type="checkbox" />
                      <span className="font-body-sm text-body-sm text-on-surface-variant">Remember counter device</span>
                    </label>
                    <a
                      className="font-label-md text-label-md text-primary-container hover:underline uppercase font-bold tracking-wider"
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        showToast('PIN reset is coming soon. Please contact CHOTU.ai support.');
                      }}
                    >
                      Forgot PIN?
                    </a>
                  </div>
                  <button className="w-full mt-2 py-3 px-space-md bg-primary-container text-white rounded-lg font-label-lg text-label-lg uppercase tracking-wider font-bold transition-all hover:bg-black hover:shadow-lg active:translate-y-0.5 shadow-md flex items-center justify-center gap-2 group border border-primary-container" type="submit" aria-busy={submitting}>
                    <span>Sign In to Terminal</span>
                    <span className="w-5 h-5 rounded flex items-center justify-center bg-[#EDEA43] text-primary-container group-hover:translate-x-0.5 transition-transform">
                      <span className="material-symbols-outlined text-[16px] font-bold">arrow_forward</span>
                    </span>
                  </button>
                </form>
                <div className="mt-space-lg text-center bg-[#FDDBA4]/25 border border-[#FDDBA4] py-2.5 px-space-md rounded-lg">
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    {"Don't have a CHOTU merchant ID? "}
                    <Link className="font-label-md text-label-md text-primary-container font-bold uppercase tracking-wider ml-1 hover:underline" to="/signup">
                      Create an Account
                    </Link>
                  </p>
                </div>
              </div>
              <div className="pt-space-lg mt-space-md flex flex-wrap items-center justify-between gap-space-xs text-on-surface-variant">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[#DEC3EB]/60 text-primary-container">
                    <span className="material-symbols-outlined text-[14px]">support_agent</span>
                  </span>
                  <span className="font-label-sm text-label-sm font-medium text-on-surface-variant">Hindi, Tamil &amp; 6+ Languages Supported</span>
                </div>
                <div className="flex items-center gap-space-sm font-label-sm text-label-sm uppercase tracking-wider text-outline">
                  <Link className="hover:text-primary-container transition-colors" to="/terms">
                    Terms
                  </Link>
                  <span>•</span>
                  <Link className="hover:text-primary-container transition-colors" to="/privacy">
                    Privacy
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <AuthFooter />
      <AuthToast text={toastText} show={toastShow} />
    </>
  );
}
