import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AUTH_BODY_CLASS, AUTH_CSS } from '../components/authPage';
import { AuthFooter } from '../components/AuthFooter';
import { FieldError } from '../components/FieldError';
import authHero from '../assets/auth-hero.png';
import { usePageStyles } from '../hooks/usePageStyles';
import { useRotator } from '../hooks/useRotator';
import { ApiError, sendOtp, signup, verifyOtp } from '../services/api';
import { saveSession } from '../services/session';
import { isEmail, isIndianMobile, isOtp } from '../utils/validation';

// Verbatim from the original script.
const greetings = [
  { text: 'Welcome', lang: 'EN', rtl: false },
  { text: 'स्वागत है', lang: 'HI', rtl: false },
  { text: 'ಸ್ವಾಗತ', lang: 'KN', rtl: false },
  { text: 'வரவேற்கிறோம்', lang: 'TA', rtl: false },
  { text: 'స్వాగతం', lang: 'TE', rtl: false },
  { text: 'സ്വാഗതം', lang: 'ML', rtl: false },
  { text: 'خوش آمدید', lang: 'UR', rtl: true },
  { text: 'স্বাগতম', lang: 'BN', rtl: false },
];

const BORDER = 'border-[#0F0F56]/25';
const inputCls = (base: string, invalid: boolean) => (invalid ? base.replace(BORDER, 'border-error') : base);

const TEXT_INPUT = `w-full h-11 px-3.5 bg-surface-container-lowest text-on-surface font-body-md text-body-md rounded-lg border ${BORDER} focus:border-[#0F0F56] focus:ring-1 focus:ring-[#0F0F56] outline-none transition-all placeholder:text-outline text-sm shadow-sm`;
const PHONE_INPUT = `w-full h-11 pl-12 pr-24 bg-surface-container-lowest text-on-surface font-body-md text-body-md rounded-lg border ${BORDER} focus:border-[#0F0F56] focus:ring-1 focus:ring-[#0F0F56] outline-none transition-all placeholder:text-outline text-sm shadow-sm`;
const OTP_INPUT = `w-full h-11 px-3.5 pr-20 bg-surface-container-lowest text-on-surface font-body-md text-body-md rounded-lg border ${BORDER} focus:border-[#0F0F56] focus:ring-1 focus:ring-[#0F0F56] outline-none tracking-widest placeholder:tracking-normal placeholder:text-outline text-sm shadow-sm`;
const PASSWORD_INPUT = `w-full h-11 px-3.5 pr-10 bg-surface-container-lowest text-on-surface font-body-md text-body-md rounded-lg border ${BORDER} focus:border-[#0F0F56] focus:ring-1 focus:ring-[#0F0F56] outline-none transition-all placeholder:text-outline text-sm shadow-sm`;
const SELECT = `w-full h-11 px-3.5 pr-8 bg-surface-container-lowest text-on-surface font-body-md text-body-md rounded-lg border ${BORDER} focus:border-[#0F0F56] focus:ring-1 focus:ring-[#0F0F56] outline-none transition-all appearance-none text-sm cursor-pointer shadow-sm`;
const CUSTOM_DOMAIN_INPUT = `w-full h-11 px-3.5 bg-surface-container-lowest text-on-surface font-body-md text-body-md rounded-lg border ${BORDER} focus:border-[#0F0F56] focus:ring-1 focus:ring-[#0F0F56] outline-none text-sm shadow-sm transition-all placeholder:text-outline`;
const LABEL = 'font-label-md text-label-md uppercase tracking-wider text-on-surface font-semibold';

type Field = 'email' | 'name' | 'phone' | 'otp' | 'password' | 'confirm' | 'city' | 'domain' | 'customDomain';
type Errors = Partial<Record<Field, string>>;
const FIELD_IDS: Record<Field, string> = {
  email: 'email',
  name: 'owner-name',
  phone: 'phone',
  otp: 'otp',
  password: 'password',
  confirm: 'confirm-password',
  city: 'city',
  domain: 'domain-select',
  customDomain: 'custom-domain',
};
const ORDER: Field[] = ['email', 'name', 'phone', 'otp', 'password', 'confirm', 'city', 'domain', 'customDomain'];

/** Source: design-reference/sign_up.html */
export default function Signup() {
  usePageStyles({ css: AUTH_CSS, bodyClass: AUTH_BODY_CLASS, title: 'CHOTU.ai | Sign up' });
  const navigate = useNavigate();

  // Original markup is a mid-animation snapshot: "স্বাগতম"/BN at opacity 0; the counter still starts at 0.
  const { shown, visible } = useRotator({ length: greetings.length, intervalMs: 1000, swapDelayMs: 180, initialShown: 7, initialVisible: false });
  const greeting = greetings[shown];

  const [values, setValues] = useState({ email: '', name: '', phone: '', otp: '', password: '', confirm: '', city: '', domain: '', customDomain: '' });
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));
  const [errors, setErrors] = useState<Errors>({});
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // OTP countdown (port of startOtpCountdown)
  const [otpSent, setOtpSent] = useState(false);
  const [timerText, setTimerText] = useState('Resend in 30s');
  const [resendDisabled, setResendDisabled] = useState(true);
  const countdown = useRef<number>();
  useEffect(() => () => window.clearInterval(countdown.current), []);

  const customDomainRef = useRef<HTMLInputElement>(null);
  const isOther = values.domain === 'Other';
  useEffect(() => {
    if (isOther) customDomainRef.current?.focus();
  }, [isOther]);

  const startOtpCountdown = (seconds = 30) => {
    setOtpSent(true); // send button text -> "Sent ✓"
    setResendDisabled(true);
    let timeLeft = seconds;
    setTimerText(`Resend in ${timeLeft}s`);
    window.clearInterval(countdown.current);
    countdown.current = window.setInterval(() => {
      timeLeft -= 1;
      if (timeLeft <= 0) {
        window.clearInterval(countdown.current);
        setTimerText("Didn't receive code?");
        setResendDisabled(false);
      } else {
        setTimerText(`Resend in ${timeLeft}s`);
      }
    }, 1000);
  };

  const requestOtp = () => {
    startOtpCountdown(30);
    sendOtp(values.phone).catch((err) => setErrors((e) => ({ ...e, phone: err instanceof ApiError ? err.message : 'Could not send OTP. Please try again.' })));
  };

  const handleSendOtp = () => {
    if (isIndianMobile(values.phone)) {
      setErrors((e) => ({ ...e, phone: undefined }));
      requestOtp();
    } else {
      setErrors((e) => ({ ...e, phone: values.phone.trim() ? 'Enter a valid 10-digit Indian mobile number (starts with 6–9).' : 'Enter your phone number.' }));
      document.getElementById('phone')?.focus();
    }
  };

  const handleDomainChange = (value: string) => {
    setValues((v) => ({ ...v, domain: value, customDomain: value === 'Other' ? v.customDomain : '' }));
  };

  const validate = (): Errors => {
    const v = values;
    const e: Errors = {};
    if (!v.email.trim()) e.email = 'Enter your email ID.';
    else if (!isEmail(v.email)) e.email = 'Enter a valid email address.';
    if (!v.name.trim()) e.name = 'Enter your name.';
    if (!v.phone.trim()) e.phone = 'Enter your phone number.';
    else if (!isIndianMobile(v.phone)) e.phone = 'Enter a valid 10-digit Indian mobile number (starts with 6–9).';
    if (!v.otp.trim()) e.otp = otpSent ? 'Enter the 6-digit OTP.' : 'Tap Send OTP, then enter the 6-digit code.';
    else if (!isOtp(v.otp)) e.otp = 'OTP must be 6 digits.';
    if (v.password.length < 8) e.password = 'Password must be at least 8 characters.';
    if (!v.confirm) e.confirm = 'Re-enter your password.';
    else if (v.confirm !== v.password) e.confirm = 'Passwords do not match.';
    if (!v.city.trim()) e.city = 'Enter your city.';
    if (!v.domain) e.domain = 'Select your business domain.';
    else if (v.domain === 'Other' && !v.customDomain.trim()) e.customDomain = 'Enter your domain.';
    return e;
  };

  const focusFirst = (e: Errors) => {
    const first = ORDER.find((f) => e[f]);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
  };

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (submitting) return;
    const e = validate();
    setErrors(e);
    if (Object.values(e).some(Boolean)) return focusFirst(e);
    setSubmitting(true);
    try {
      const { verified } = await verifyOtp(values.phone, values.otp.trim());
      if (!verified) {
        const err = { otp: 'Incorrect or expired OTP. Tap Resend to get a new code.' };
        setErrors(err);
        focusFirst(err);
        setSubmitting(false);
        return;
      }
      const session = await signup({
        email: values.email.trim(),
        name: values.name.trim(),
        phone: values.phone,
        otp: values.otp.trim(),
        password: values.password,
        city: values.city.trim(),
        businessDomain: isOther ? values.customDomain.trim() : values.domain,
      });
      saveSession(session, true);
      navigate('/home', { replace: true });
    } catch (err) {
      const field = (err instanceof ApiError && err.field && err.field in FIELD_IDS ? err.field : 'email') as Field;
      const next = { [field]: err instanceof ApiError ? err.message : 'Something went wrong. Please try again.' };
      setErrors(next);
      focusFirst(next);
      setSubmitting(false);
    }
  };

  const aria = (f: Field) => (errors[f] ? { 'aria-invalid': true as const, 'aria-describedby': `${FIELD_IDS[f]}-error` } : {});

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
        <div className="flex flex-col w-full py-4 md:py-8 items-center justify-center">
          <div className="max-w-5xl w-full mx-auto bg-surface-container-lowest rounded-xl shadow-xl flex flex-col md:flex-row overflow-hidden my-2">
            {/* Left Illustration & Multilingual Welcome Panel */}
            <div className="relative w-full md:w-5/12 h-52 sm:h-64 md:h-auto min-h-[220px] bg-surface-container-low flex flex-col justify-between overflow-hidden">
              <img alt="CHOTU.ai Shopkeeper Counter Illustration" className="absolute inset-0 w-full h-full object-cover object-center" src={authHero} />
              <div className="relative z-10 p-space-md flex items-center justify-between pointer-events-none">
                <span className="bg-primary-container text-on-primary font-label-sm text-label-sm uppercase tracking-widest px-2.5 py-1 rounded-sm shadow-sm">COUNTER AI ASSISTANT</span>
                <span className="bg-[#EDEA43] text-[#0F0F56] font-label-sm text-label-sm font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border border-[#0F0F56]/20 shadow-sm">VOICE &amp; KHATA</span>
              </div>
              <div className="relative z-10 p-space-md mt-auto">
                <div className="bg-surface/95 backdrop-blur-md p-space-sm rounded-sm shadow-md max-w-[260px]">
                  <div className="flex items-center gap-space-xs mb-1">
                    <span className="w-2 h-2 rounded-full bg-secondary"></span>
                    <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-bold">Multilingual Counter</span>
                  </div>
                  <div className="h-8 flex items-center overflow-hidden">
                    <div className="transition-opacity duration-300 opacity-100 flex items-baseline gap-2" id="greeting-container" style={{ opacity: visible ? 1 : 0 }}>
                      <span className="font-headline-sm text-headline-sm text-primary-container tracking-wide font-bold" id="greeting-text" dir={greeting.rtl ? 'rtl' : undefined}>
                        {greeting.text}
                      </span>
                      <span className="font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold" id="greeting-lang">
                        {greeting.lang}
                      </span>
                    </div>
                  </div>
                  <p className="font-body-sm text-body-sm text-on-surface-variant text-[11px] leading-tight mt-0.5">Real-time billing &amp; ledger in 8+ Indian regional languages</p>
                </div>
              </div>
            </div>
            {/* Right Sign-Up Form Panel */}
            <div className="w-full md:w-7/12 p-space-md sm:p-space-lg lg:p-space-xl bg-surface-container-lowest flex flex-col justify-center">
              <div className="mb-space-md">
                <div className="flex items-center gap-space-xs mb-1">
                  <span className="material-symbols-outlined text-primary-container text-[20px]">storefront</span>
                  <span className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">Merchant Registration</span>
                </div>
                <h1 className="font-headline-lg text-headline-lg text-primary tracking-tight uppercase">Create Shop Account</h1>
                <p className="font-body-md text-body-md text-on-surface-variant">Set up voice assistance for your counter in minutes.</p>
              </div>
              <form className="flex flex-col gap-y-3.5" id="signup-form" onSubmit={onSubmit} noValidate>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-space-md gap-y-3.5">
                  {/* 1. Email ID */}
                  <div className="flex flex-col gap-1.5">
                    <label className={LABEL} htmlFor="email">
                      Email ID <span className="text-error">*</span>
                    </label>
                    <input className={inputCls(TEXT_INPUT, !!errors.email)} id="email" name="email" placeholder="merchant@kirana.com" required type="email" autoComplete="email" value={values.email} onChange={set('email')} {...aria('email')} />
                    <FieldError id="email-error" message={errors.email} />
                  </div>
                  {/* 2. Name */}
                  <div className="flex flex-col gap-1.5">
                    <label className={LABEL} htmlFor="owner-name">
                      Name <span className="text-error">*</span>
                    </label>
                    <input className={inputCls(TEXT_INPUT, !!errors.name)} id="owner-name" name="owner_name" placeholder="Shop owner or manager name" required type="text" autoComplete="name" value={values.name} onChange={set('name')} {...aria('name')} />
                    <FieldError id="owner-name-error" message={errors.name} />
                  </div>
                  {/* 3. Phone Number with Send OTP button */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className={LABEL} htmlFor="phone">
                        Phone Number <span className="text-error">*</span>
                      </label>
                    </div>
                    <div className="relative flex items-center">
                      <span className="absolute left-3.5 font-label-md text-label-md text-on-surface-variant font-bold pointer-events-none">+91</span>
                      <input className={inputCls(PHONE_INPUT, !!errors.phone)} id="phone" maxLength={10} name="phone" placeholder="10-digit mobile number" required type="tel" inputMode="numeric" autoComplete="tel-national" value={values.phone} onChange={set('phone')} {...aria('phone')} />
                      <button className="absolute right-1.5 px-3 py-1.5 text-label-sm font-label-sm uppercase tracking-wider bg-[#EDEA43] text-[#0F0F56] font-bold rounded-lg hover:brightness-95 transition-all shadow-sm border border-[#0F0F56]/20" id="send-otp-btn" onClick={handleSendOtp} type="button">
                        {otpSent ? 'Sent ✓' : 'Send OTP'}
                      </button>
                    </div>
                    <FieldError id="phone-error" message={errors.phone} />
                  </div>
                  {/* 4. Enter OTP with countdown/resend */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className={LABEL} htmlFor="otp">
                        Enter OTP <span className="text-error">*</span>
                      </label>
                      <span className="font-label-sm text-label-sm text-on-surface-variant font-semibold" id="otp-timer" aria-live="polite">
                        {timerText}
                      </span>
                    </div>
                    <div className="relative flex items-center">
                      <input className={inputCls(OTP_INPUT, !!errors.otp)} id="otp" maxLength={6} name="otp" placeholder="6-digit code" type="text" inputMode="numeric" autoComplete="one-time-code" value={values.otp} onChange={set('otp')} {...aria('otp')} />
                      <button className="absolute right-3 text-label-sm font-label-sm uppercase text-primary-container hover:underline disabled:opacity-40 disabled:no-underline font-bold" disabled={resendDisabled} id="resend-btn" onClick={requestOtp} type="button">
                        Resend
                      </button>
                    </div>
                    <FieldError id="otp-error" message={errors.otp} />
                  </div>
                  {/* 5. Create Password */}
                  <div className="flex flex-col gap-1.5">
                    <label className={LABEL} htmlFor="password">
                      Create Password <span className="text-error">*</span>
                    </label>
                    <div className="relative flex items-center">
                      <input className={inputCls(PASSWORD_INPUT, !!errors.password)} id="password" name="password" placeholder="At least 8 characters" required type={showPwd ? 'text' : 'password'} autoComplete="new-password" value={values.password} onChange={set('password')} {...aria('password')} />
                      <button aria-label="Toggle password visibility" className="absolute right-2.5 text-on-surface-variant hover:text-on-surface flex items-center justify-center p-1" onClick={() => setShowPwd((s) => !s)} type="button">
                        <span className="material-symbols-outlined text-[18px]" id="pwd-toggle-icon">
                          {showPwd ? 'visibility_off' : 'visibility'}
                        </span>
                      </button>
                    </div>
                    <FieldError id="password-error" message={errors.password} />
                  </div>
                  {/* 6. Confirm Password */}
                  <div className="flex flex-col gap-1.5">
                    <label className={LABEL} htmlFor="confirm-password">
                      Confirm Password <span className="text-error">*</span>
                    </label>
                    <div className="relative flex items-center">
                      <input className={inputCls(PASSWORD_INPUT, !!errors.confirm)} id="confirm-password" name="confirm_password" placeholder="Re-enter password" required type={showConfirm ? 'text' : 'password'} autoComplete="new-password" value={values.confirm} onChange={set('confirm')} {...aria('confirm')} />
                      <button aria-label="Toggle confirm password visibility" className="absolute right-2.5 text-on-surface-variant hover:text-on-surface flex items-center justify-center p-1" onClick={() => setShowConfirm((s) => !s)} type="button">
                        <span className="material-symbols-outlined text-[18px]" id="confirm-pwd-toggle-icon">
                          {showConfirm ? 'visibility_off' : 'visibility'}
                        </span>
                      </button>
                    </div>
                    <FieldError id="confirm-password-error" message={errors.confirm} />
                  </div>
                  {/* 7. City */}
                  <div className="flex flex-col gap-1.5">
                    <label className={LABEL} htmlFor="city">
                      City <span className="text-error">*</span>
                    </label>
                    <input className={inputCls(TEXT_INPUT, !!errors.city)} id="city" name="city" placeholder="e.g. Bengaluru, Mumbai, Jaipur" required type="text" autoComplete="address-level2" value={values.city} onChange={set('city')} {...aria('city')} />
                    <FieldError id="city-error" message={errors.city} />
                  </div>
                  {/* 8. Business Domain */}
                  <div className="flex flex-col gap-1.5">
                    <label className={LABEL} htmlFor="domain-select">
                      Business Domain <span className="text-error">*</span>
                    </label>
                    <div className="relative flex items-center">
                      <select className={inputCls(SELECT, !!errors.domain)} id="domain-select" name="business_domain" onChange={(e) => handleDomainChange(e.target.value)} required value={values.domain} {...aria('domain')}>
                        <option disabled value="">
                          Select category...
                        </option>
                        <option value="Provision">Provision</option>
                        <option value="Medical">Medical</option>
                        <option value="Grocery">Grocery</option>
                        <option value="Fancy">Fancy</option>
                        <option value="Food">Food</option>
                        <option value="Other">Other</option>
                      </select>
                      <span className="material-symbols-outlined pointer-events-none absolute right-2.5 text-[20px] text-on-surface-variant">arrow_drop_down</span>
                    </div>
                    <FieldError id="domain-select-error" message={errors.domain} />
                  </div>
                </div>
                {/* Dynamically revealed "Other" Domain Input Field */}
                <div className={`${isOther ? '' : 'hidden '}flex flex-col gap-1 mt-1 transition-all`} id="other-domain-container">
                  <label className="font-label-md text-label-md uppercase tracking-wider text-on-surface" htmlFor="custom-domain">
                    Enter your domain <span className="text-error">*</span>
                  </label>
                  <input ref={customDomainRef} className={inputCls(CUSTOM_DOMAIN_INPUT, !!errors.customDomain)} id="custom-domain" name="custom_domain" placeholder="e.g. Hardware, Bakery, Electricals" type="text" required={isOther} value={values.customDomain} onChange={set('customDomain')} {...aria('customDomain')} />
                  <FieldError id="custom-domain-error" message={errors.customDomain} />
                </div>
                {/* Quick feature pills */}
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <span className="inline-flex items-center gap-1.5 font-label-sm text-label-sm px-2.5 py-1 bg-[#C2DCE3] text-[#0F0F56] rounded-lg font-bold border border-[#0F0F56]/10 shadow-sm">
                    <span className="material-symbols-outlined text-[14px]">mic</span> WhatsApp &amp; Voice Sync
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-label-sm text-label-sm px-2.5 py-1 bg-[#FDDBA4] text-[#0F0F56] rounded-lg font-bold border border-[#0F0F56]/10 shadow-sm">
                    <span className="material-symbols-outlined text-[14px]">receipt_long</span> Digital Bahi Khata
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-label-sm text-label-sm px-2.5 py-1 bg-[#DEC3EB] text-[#0F0F56] rounded-lg font-bold border border-[#0F0F56]/10 shadow-sm">
                    <span className="material-symbols-outlined text-[14px]">offline_bolt</span> Offline First
                  </span>
                  <span className="inline-flex items-center gap-1 font-label-sm text-label-sm px-2 py-1 bg-[#EDEA43] text-[#0F0F56] rounded-lg font-bold border border-[#0F0F56]/20 shadow-sm">
                    <span className="material-symbols-outlined text-[14px]">bolt</span> 0 Setup Fee
                  </span>
                </div>
                {/* Primary Action Button */}
                <div className="pt-2">
                  <button className="w-full h-11 bg-primary-container text-on-primary font-label-lg text-label-lg uppercase tracking-wider rounded-lg font-bold flex items-center justify-center gap-2 hover:brightness-125 active:translate-y-0.5 transition-all shadow-md" type="submit" aria-busy={submitting}>
                    <span>Create Account</span>
                    <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                  </button>
                </div>
                {/* Secondary Login Redirection */}
                <div className="flex items-center justify-center gap-1.5 pt-1">
                  <span className="font-body-sm text-body-sm text-on-surface-variant">Already have an account?</span>
                  <Link className="font-label-md text-label-md uppercase tracking-wider text-primary-container font-bold hover:underline" data-path="login" to="/login">
                    Sign in
                  </Link>
                </div>
                {/* Legal Disclaimer & Links */}
                <div className="border-t border-surface-container-high pt-3 mt-1 flex flex-col sm:flex-row items-center justify-between text-center sm:text-left gap-1">
                  <p className="font-body-sm text-body-sm text-on-surface-variant text-[11px] leading-tight">By creating an account, you agree to CHOTU.ai merchant terms.</p>
                  <div className="flex items-center gap-3">
                    <Link className="font-label-sm text-label-sm uppercase text-on-surface-variant hover:text-on-surface underline" data-path="terms-and-conditions" to="/terms">
                      Terms &amp; Conditions
                    </Link>
                    <span className="text-outline-variant font-bold text-[10px]">•</span>
                    <Link className="font-label-sm text-label-sm uppercase text-on-surface-variant hover:text-on-surface underline" data-path="privacy-policy" to="/privacy">
                      Privacy Policy
                    </Link>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </main>
      <AuthFooter />
    </>
  );
}
