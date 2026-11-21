import { useState, useRef, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePageStyles } from '../hooks/usePageStyles';
import { PROFILE_BODY_CLASS, PROFILE_CSS } from '../components/profilePage';
import { useToast } from '../hooks/useToast';
import { AuthToast } from '../components/AuthToast';
import { getSession, updateSessionUser, clearSession } from '../services/session';
import { updateProfile, logout } from '../services/api';
import shopOwnerDefaultImg from '../assets/shop-owner.jpg';
import { LanguageSelector } from '../components/LanguageSelector';

type Tab =
  | 'shop-profile'
  | 'voice-assistant'
  | 'notifications'
  | 'backup'
  | 'preferences'
  | 'security'
  | 'about';

interface ProfileState {
  shopName: string;
  ownerName: string;
  phone: string;
  businessDomain: string;
  gstNumber: string;
  fssaiNumber: string;
  address: string;
  avatarUrl: string;
  primaryLanguage: string;
  secondaryLanguage: string;
  spokenReplies: boolean;
  voiceSpeed: 'Slow' | 'Normal' | 'Fast';
  voiceVolume: number;
  dailyLedgerPdf: boolean;
  lowStockAlert: boolean;
  paymentReminder: boolean;
}

const STORAGE_SETTINGS_KEY = 'chotu.profile.settings';

export default function Profile() {
  usePageStyles({
    css: PROFILE_CSS,
    bodyClass: PROFILE_BODY_CLASS,
    title: 'CHOTU.ai | Shop & Account Settings',
  });

  const navigate = useNavigate();
  const session = getSession();
  const currentUser = session?.user;

  const { text: toastText, show: toastShow, showToast } = useToast();

  const [activeTab, setActiveTab] = useState<Tab>('shop-profile');
  const [showLogoutBanner, setShowLogoutBanner] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Profile data initialized from session user or localStorage
  const [formData, setFormData] = useState<ProfileState>(() => {
    const saved = localStorage.getItem(STORAGE_SETTINGS_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    return {
      shopName: currentUser?.shopName || 'Lakshmi Provision & General Stores',
      ownerName: currentUser?.name || 'Ramesh Kumar',
      phone: currentUser?.phone || '98451 23456',
      businessDomain: currentUser?.businessDomain || 'Kirana / Provision Store',
      gstNumber: currentUser?.gstNumber || '29AAAAA0000A1Z5',
      fssaiNumber: currentUser?.fssaiNumber || '11223344001928',
      address:
        currentUser?.address ||
        'Shop #14, Main Bazaar Road, Near Old Bus Stand, Mandya, Karnataka - 571401',
      avatarUrl: shopOwnerDefaultImg,
      primaryLanguage: 'Kannada (ಕನ್ನಡ) - Southern Dialect',
      secondaryLanguage: 'Hindi (हिन्दी) - Hinglish Hybrid',
      spokenReplies: true,
      voiceSpeed: 'Normal',
      voiceVolume: 80,
      dailyLedgerPdf: true,
      lowStockAlert: true,
      paymentReminder: true,
    };
  });

  // Track initial copy to enable discard
  const initialDataRef = useRef<ProfileState>(formData);

  // Hidden file input for custom avatar upload
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to section on tab switch if desktop/mobile
  const sectionRefs = {
    'shop-profile': useRef<HTMLDivElement>(null),
    'voice-assistant': useRef<HTMLDivElement>(null),
    'notifications': useRef<HTMLDivElement>(null),
    'backup': useRef<HTMLDivElement>(null),
    'preferences': useRef<HTMLDivElement>(null),
    'security': useRef<HTMLDivElement>(null),
    'about': useRef<HTMLDivElement>(null),
  };

  const scrollToTab = (tab: Tab) => {
    setActiveTab(tab);
    const target = sectionRefs[tab]?.current;
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Avatar upload handler (converts file to local object/data URL)
  const handleAvatarChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        showToast('Image size should be under 2MB.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result as string;
        setFormData((prev) => ({ ...prev, avatarUrl: url }));
        showToast('Avatar updated locally.');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDeleteAvatar = () => {
    setFormData((prev) => ({ ...prev, avatarUrl: shopOwnerDefaultImg }));
    showToast('Avatar reset to default.');
  };

  const handleVoiceTest = () => {
    if ('speechSynthesis' in window) {
      const text =
        formData.primaryLanguage.includes('Hindi')
          ? 'नमस्ते! मैं छोटू हूँ। आपकी दुकान का क्या हिसाब देखें?'
          : formData.primaryLanguage.includes('Kannada')
          ? 'ನಮಸ್ಕಾರ! ನಾನು ನಿಮ್ಮ ಚೋಟು. ಇವತ್ತಿನ ಖಾತೆ ಲೆಕ್ಕ ಪ್ರಾರಂಭಿಸೋಣವೇ?'
          : 'Hello! I am Chotu. Ready to record orders for your store.';
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate =
        formData.voiceSpeed === 'Slow' ? 0.8 : formData.voiceSpeed === 'Fast' ? 1.2 : 1.0;
      utter.volume = formData.voiceVolume / 100;
      window.speechSynthesis.speak(utter);
      showToast('Playing "Hey Chotu!" vernacular voice sample...');
    } else {
      showToast('Counter voice test: "Hey Chotu!" simulated successfully.');
    }
  };

  const handleBackupNow = () => {
    showToast('Encrypting & syncing daily ledger to local memory and cloud...');
    setTimeout(() => {
      showToast('Daily Khata backup completed successfully!');
    }, 1200);
  };

  const handleDownloadBackup = () => {
    showToast('Exporting Khata ledger report (PDF/Excel)...');
  };

  const handleDiscard = () => {
    setFormData(initialDataRef.current);
    showToast('Changes discarded.');
  };

  const handleSave = async () => {
    if (!formData.shopName.trim()) {
      showToast('Shop Name is required.');
      return;
    }
    if (!formData.ownerName.trim()) {
      showToast('Owner Name is required.');
      return;
    }
    if (!formData.phone.trim()) {
      showToast('Mobile / WhatsApp Number is required.');
      return;
    }
    if (!formData.address.trim()) {
      showToast('Complete Shop Address is required.');
      return;
    }

    setIsSaving(true);
    try {
      await updateProfile(formData);
      localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(formData));
      updateSessionUser({
        name: formData.ownerName,
        phone: formData.phone.replace(/\D/g, '').slice(-10),
        businessDomain: formData.businessDomain,
        shopName: formData.shopName,
        address: formData.address,
        gstNumber: formData.gstNumber,
        fssaiNumber: formData.fssaiNumber,
      });
      initialDataRef.current = formData;
      showToast('Settings saved successfully!');
    } catch {
      showToast('Failed to save settings. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // ignore
    } finally {
      clearSession();
      navigate('/login', { replace: true });
    }
  };

  return (
    <>
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleAvatarChange}
        accept="image/*"
        className="hidden"
        aria-hidden="true"
      />

      <div className="flex flex-col">

        {/* Main Content Page */}
        <main className="relative bg-background flex-1">
          <div className="w-full flex flex-col gap-space-lg">
            {/* Page Header / Breadcrumb */}
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-space-md pb-space-sm border-b border-on-primary-fixed/10">
              <div className="flex flex-col">
                <nav className="flex items-center gap-2 mb-1" aria-label="Breadcrumb">
                  <Link
                    to="/home"
                    className="font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface uppercase"
                  >
                    Home
                  </Link>
                  <span className="text-on-surface-variant text-xs">/</span>
                  <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">
                    Settings
                  </span>
                  <span className="text-on-surface-variant text-xs">/</span>
                  <span className="font-label-sm text-label-sm font-bold text-on-primary-fixed uppercase tracking-wider">
                    My Profile
                  </span>
                </nav>
                <h1 className="font-headline-lg text-headline-lg uppercase text-on-primary-fixed tracking-tight">
                  Shop &amp; Account Settings
                </h1>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                  Manage your kirana identity, dialect voice assistant, daily ledger sync, and automated
                  WhatsApp billing parameters.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:gap-space-md xl:justify-end">
                {/* Moved from the old top bar (the app shell now provides the logo and navigation) */}
                <span className="hidden font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider lg:block">
                  Merchant Terminal
                </span>
                <LanguageSelector variant="header" />
                <button
                  className="flex items-center gap-1.5 sm:gap-2 bg-secondary-container text-on-primary-fixed px-2.5 sm:px-3 py-1.5 rounded-lg shadow-[2px_2px_0px_#0F0F56] transition-all hover:bg-secondary-fixed active:translate-y-0.5 font-bold"
                  type="button"
                  onClick={handleVoiceTest}
                >
                  <span className="material-symbols-outlined text-lg">mic</span>
                  <span className="font-label-md text-label-md uppercase tracking-wider text-xs sm:text-sm">
                    Quick Record
                  </span>
                </button>
                <div className="h-6 w-[1px] bg-surface-container-highest"></div>
                <button
                  type="button"
                  aria-label={`Profile settings for ${formData.ownerName}`}
                  className="flex items-center gap-2 bg-surface-container-lowest px-2 py-1 rounded-lg border border-on-primary-fixed/10 cursor-pointer hover:bg-surface-container transition-colors"
                  onClick={() => scrollToTab('shop-profile')}
                >
                  <div className="hidden md:flex flex-col text-right">
                    <span className="font-label-md text-label-md text-on-surface font-bold leading-tight">
                      {formData.ownerName}
                    </span>
                    <span className="font-label-sm text-label-sm text-on-surface-variant">
                      Verified Merchant
                    </span>
                  </div>
                  <img
                    alt="Profile"
                    className="w-8 h-8 rounded-full object-cover border border-primary-container"
                    src={formData.avatarUrl}
                  />
                </button>
                {/* Quick Voice Status Badge */}
                <div
                  onClick={handleVoiceTest}
                  className="inline-flex items-center gap-3 bg-surface-container-lowest px-3.5 py-2 rounded-lg border border-on-primary-fixed/15 shadow-[2px_2px_0px_#0F0F56] self-start md:self-auto cursor-pointer hover:bg-surface-container-low active:translate-y-0.5 transition-all"
                  title="Click to test live terminal dialect"
                >
                  <div className="relative flex items-center justify-center">
                    <span className="w-3 h-3 rounded-full bg-secondary-container animate-ping absolute"></span>
                    <span className="w-2.5 h-2.5 rounded-full bg-secondary-container relative"></span>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                      Live Terminal Voice
                    </span>
                    <span className="font-label-md text-label-md font-bold text-on-primary-fixed flex items-center gap-1">
                      {formData.primaryLanguage.split(' ')[0]} &amp;{' '}
                      {formData.secondaryLanguage.split(' ')[0]}
                      <span className="material-symbols-outlined text-xs text-on-surface-variant">
                        tune
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Layout Grid: Left Settings Navigation + Right Form Canvas */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-lg items-start">
              {/* Left Settings Sidebar */}
              <aside className="xl:col-span-3 bg-surface-container-lowest rounded-xl border border-on-primary-fixed/15 shadow-sm p-space-md flex flex-col gap-6">
                <div>
                  <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant px-2 block mb-2 font-bold">
                    Terminal Control
                  </span>
                  <nav className="flex flex-col gap-1.5" id="settings-nav">
                    <button
                      type="button"
                      onClick={() => scrollToTab('shop-profile')}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-all ${
                        activeTab === 'shop-profile'
                          ? 'bg-tertiary-fixed/35 border-l-4 border-primary-container text-on-primary-fixed font-bold'
                          : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 font-label-lg text-label-lg">
                        <span
                          className={`material-symbols-outlined text-lg ${
                            activeTab === 'shop-profile' ? 'text-primary-container' : ''
                          }`}
                        >
                          store
                        </span>
                        Shop &amp; Profile
                      </span>
                      {activeTab === 'shop-profile' && (
                        <span className="material-symbols-outlined text-sm text-primary-container">
                          arrow_forward_ios
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => scrollToTab('voice-assistant')}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-all ${
                        activeTab === 'voice-assistant'
                          ? 'bg-tertiary-fixed/35 border-l-4 border-primary-container text-on-primary-fixed font-bold'
                          : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 font-label-lg text-label-lg">
                        <span className="material-symbols-outlined text-lg">record_voice_over</span>
                        Voice &amp; &ldquo;Hey Chotu!&rdquo;
                      </span>
                      <span className="w-2 h-2 rounded-full bg-secondary-container"></span>
                    </button>

                    <button
                      type="button"
                      onClick={() => scrollToTab('notifications')}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-all ${
                        activeTab === 'notifications'
                          ? 'bg-tertiary-fixed/35 border-l-4 border-primary-container text-on-primary-fixed font-bold'
                          : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 font-label-lg text-label-lg">
                        <span className="material-symbols-outlined text-lg">notifications</span>
                        Notifications &amp; Alerts
                      </span>
                      <span className="font-label-sm text-label-sm bg-surface-container-high px-1.5 py-0.5 rounded text-on-surface-variant font-bold">
                        3
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => scrollToTab('backup')}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-all ${
                        activeTab === 'backup'
                          ? 'bg-tertiary-fixed/35 border-l-4 border-primary-container text-on-primary-fixed font-bold'
                          : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 font-label-lg text-label-lg">
                        <span className="material-symbols-outlined text-lg">cloud_sync</span>
                        Data &amp; Khata Backup
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => scrollToTab('preferences')}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-all ${
                        activeTab === 'preferences'
                          ? 'bg-tertiary-fixed/35 border-l-4 border-primary-container text-on-primary-fixed font-bold'
                          : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 font-label-lg text-label-lg">
                        <span className="material-symbols-outlined text-lg">display_settings</span>
                        App Preferences
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => scrollToTab('security')}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-all ${
                        activeTab === 'security'
                          ? 'bg-tertiary-fixed/35 border-l-4 border-primary-container text-on-primary-fixed font-bold'
                          : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 font-label-lg text-label-lg">
                        <span className="material-symbols-outlined text-lg">lock_person</span>
                        Account &amp; Security
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => scrollToTab('about')}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-all ${
                        activeTab === 'about'
                          ? 'bg-tertiary-fixed/35 border-l-4 border-primary-container text-on-primary-fixed font-bold'
                          : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 font-label-lg text-label-lg">
                        <span className="material-symbols-outlined text-lg">info</span>
                        About CHOTU.ai
                      </span>
                      <span className="font-label-sm text-label-sm text-on-surface-variant">v2.4</span>
                    </button>
                  </nav>
                </div>

                {/* Thermal POS Sync Card */}
                <div className="bg-surface-container p-3 rounded-lg border border-on-primary-fixed/10 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="font-label-sm text-label-sm uppercase font-bold text-on-surface">
                      Thermal POS Sync
                    </span>
                    <span className="font-label-sm text-label-sm bg-tertiary-fixed text-on-tertiary-fixed px-1.5 py-0.5 rounded font-bold">
                      PAIRED
                    </span>
                  </div>
                  <p className="font-body-sm text-body-sm text-on-surface-variant text-xs leading-tight">
                    Bluetooth ESC/POS 58mm printer connected to counter 01.
                  </p>
                </div>

                {/* Logout Action */}
                <div className="pt-4 border-t border-on-primary-fixed/10 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setShowLogoutBanner((prev) => !prev)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-error hover:bg-error-container/40 transition-colors font-label-lg text-label-lg font-bold"
                  >
                    <span className="material-symbols-outlined text-lg">logout</span>
                    Log Out Counter Device
                  </button>

                  {showLogoutBanner && (
                    <div
                      id="logout-banner"
                      className="bg-[#FDDBA4]/50 p-3 rounded-lg border border-on-primary-fixed/20 flex flex-col gap-2 transition-all"
                    >
                      <div className="flex items-start gap-2">
                        <span className="material-symbols-outlined text-error text-base mt-0.5 shrink-0">
                          warning
                        </span>
                        <p className="font-body-sm text-body-sm text-on-surface text-xs leading-normal">
                          Are you sure you want to log out of your counter device? Offline orders will
                          stay queued locally.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <button
                          type="button"
                          onClick={handleLogout}
                          className="bg-primary-container text-surface-container-lowest font-label-sm text-label-sm px-3 py-1 rounded font-bold shadow-sm hover:translate-y-0.5"
                        >
                          Yes, Exit
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowLogoutBanner(false)}
                          className="bg-surface-container-lowest text-on-surface font-label-sm text-label-sm px-3 py-1 rounded border border-on-primary-fixed/20 hover:bg-surface-container"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </aside>

              {/* Right Content Sections */}
              <section className="xl:col-span-9 flex flex-col gap-space-lg">
                <div className="bg-surface-container-lowest rounded-xl border border-on-primary-fixed/15 shadow-sm p-space-md lg:p-space-lg flex flex-col gap-8">
                  {/* Section 1: Profile & Shop Identity */}
                  <div
                    ref={sectionRefs['shop-profile']}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 pb-6 border-b border-on-primary-fixed/10"
                  >
                    <div className="flex items-center gap-5">
                      <div className="relative group shrink-0">
                        <img
                          alt="Kirana Shop Owner"
                          className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover border-2 border-primary-container shadow-[2px_2px_0px_#0F0F56]"
                          src={formData.avatarUrl}
                        />
                        <button
                          className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-secondary-container text-on-primary-fixed border border-primary-container flex items-center justify-center shadow hover:bg-secondary-fixed transition-transform transform active:scale-95"
                          title="Change Avatar"
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <span className="material-symbols-outlined text-base">photo_camera</span>
                        </button>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-headline-md text-headline-md uppercase text-on-primary-fixed leading-none">
                            {formData.ownerName}
                          </h2>
                          <span className="bg-[#DEC3EB] text-primary-container font-label-sm text-label-sm px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                            Store ID: KRN-8821
                          </span>
                          <span className="inline-flex items-center gap-1 bg-[#C2DCE3] text-primary-container font-label-sm text-label-sm px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                            <span className="material-symbols-outlined text-xs">verified</span> WhatsApp
                            Verified
                          </span>
                        </div>
                        <p className="font-body-sm text-body-sm text-on-surface-variant">
                          Primary Sign-in Account • Registered via Aadhaar Merchant eKYC
                        </p>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="bg-primary-container text-surface-container-lowest font-label-md text-label-md px-4 py-1.5 rounded-sm border border-primary-container shadow-[2px_2px_0px_#0F0F56] hover:translate-y-0.5 active:translate-y-0.5 transition-all font-bold"
                          >
                            Upload New Photo
                          </button>
                          <button
                            type="button"
                            onClick={handleDeleteAvatar}
                            className="bg-surface-container-lowest text-on-surface font-label-md text-label-md px-3.5 py-1.5 rounded-sm border border-on-primary-fixed/20 hover:bg-surface-container transition-all"
                          >
                            Delete Avatar
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col sm:items-end justify-center bg-surface-container-low p-3 rounded-lg border border-on-primary-fixed/10 self-stretch sm:self-auto">
                      <span className="font-label-sm text-label-sm uppercase text-on-surface-variant">
                        Daily Shop Uptime
                      </span>
                      <span className="font-headline-sm text-headline-sm text-on-primary-fixed font-bold">
                        14 hrs 20 mins
                      </span>
                      <span className="font-body-sm text-body-sm text-on-surface-variant text-xs">
                        Terminal Active since 06:45 AM
                      </span>
                    </div>
                  </div>

                  {/* Section 2: Counter Voice & "Hey Chotu!" Engine */}
                  <div
                    ref={sectionRefs['voice-assistant']}
                    className="bg-[#C2DCE3]/30 rounded-xl border border-on-primary-fixed/20 p-space-md flex flex-col gap-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-on-primary-fixed/15 pb-3">
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-md bg-secondary-container border border-primary-container flex items-center justify-center text-primary-container shadow-[1px_1px_0px_#0F0F56]">
                          <span className="material-symbols-outlined text-lg">mic</span>
                        </span>
                        <div>
                          <h3 className="font-headline-sm text-headline-sm text-on-primary-fixed uppercase tracking-wide">
                            Counter Voice &amp; &ldquo;Hey Chotu!&rdquo; Engine
                          </h3>
                          <p className="font-body-sm text-body-sm text-on-surface-variant text-xs">
                            Speaks, transcribes, and detects vernacular dialect weights directly from your
                            microphone.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleVoiceTest}
                        className="inline-flex items-center gap-1.5 bg-[#EDEA43] text-primary-container font-label-md text-label-md px-3.5 py-1.5 rounded-sm border border-primary-container shadow-[2px_2px_0px_#0F0F56] hover:bg-secondary-fixed transition-all font-bold active:translate-y-0.5"
                      >
                        <span className="material-symbols-outlined text-base">record_voice_over</span>
                        Test &ldquo;Hey Chotu!&rdquo;
                      </button>
                    </div>

                    {/* Language Dropdowns */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="primary-language-select"
                          className="font-label-md text-label-md uppercase tracking-wider text-on-primary-fixed font-bold flex items-center justify-between"
                        >
                          <span>Voice Assistant Primary Language *</span>
                          <span className="font-label-sm text-label-sm bg-primary-container text-surface-container-lowest px-1.5 py-0.5 rounded uppercase font-bold">
                            Active on Counter
                          </span>
                        </label>
                        <div className="relative">
                          <select
                            id="primary-language-select"
                            value={formData.primaryLanguage}
                            onChange={(e) =>
                              setFormData({ ...formData, primaryLanguage: e.target.value })
                            }
                            className="w-full bg-surface-container-lowest border border-on-primary-fixed rounded-sm px-3 py-2 font-body-md text-body-md text-on-surface appearance-none focus:outline-none focus:ring-1 focus:ring-primary-container pr-10 shadow-sm font-medium"
                          >
                            <option>Kannada (ಕನ್ನಡ) - Southern Dialect</option>
                            <option>Hindi (हिन्दी) - Devanagari</option>
                            <option>Tamil (தமிழ்)</option>
                            <option>Telugu (తెలుగు)</option>
                            <option>English (Indian Retail Accent)</option>
                          </select>
                          <span className="material-symbols-outlined absolute right-2.5 top-2.5 pointer-events-none text-on-primary-fixed text-lg">
                            arrow_drop_down
                          </span>
                        </div>
                        <span className="font-body-sm text-body-sm text-on-surface-variant text-xs">
                          Controls both screen vernacular text and real-time speech recognition for counter
                          sales.
                        </span>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="secondary-language-select"
                          className="font-label-md text-label-md uppercase tracking-wider text-on-primary-fixed font-bold"
                        >
                          Secondary Whisper Language
                        </label>
                        <div className="relative">
                          <select
                            id="secondary-language-select"
                            value={formData.secondaryLanguage}
                            onChange={(e) =>
                              setFormData({ ...formData, secondaryLanguage: e.target.value })
                            }
                            className="w-full bg-surface-container-lowest border border-on-primary-fixed/40 rounded-sm px-3 py-2 font-body-md text-body-md text-on-surface appearance-none focus:outline-none focus:ring-1 focus:ring-primary-container pr-10 shadow-sm font-medium"
                          >
                            <option>Hindi (हिन्दी) - Hinglish Hybrid</option>
                            <option>Kannada (ಕನ್ನಡ)</option>
                            <option>English (India)</option>
                            <option>Marathi (मराठी)</option>
                          </select>
                          <span className="material-symbols-outlined absolute right-2.5 top-2.5 pointer-events-none text-on-primary-fixed text-lg">
                            arrow_drop_down
                          </span>
                        </div>
                        <span className="font-body-sm text-body-sm text-on-surface-variant text-xs">
                          Used when customer mixes languages (e.g., &ldquo;Do kilo sugar aur Mysore Pak
                          packs&rdquo;).
                        </span>
                      </div>
                    </div>

                    {/* Voice Controls Row */}
                    <div className="pt-3 border-t border-on-primary-fixed/15 grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
                      {/* Spoken Replies Toggle */}
                      <div className="flex items-center justify-between bg-surface-container-lowest px-3 py-2 rounded-lg border border-on-primary-fixed/15">
                        <div className="flex flex-col">
                          <span className="font-label-md text-label-md font-bold text-on-surface">
                            Spoken Replies
                          </span>
                          <span className="font-body-sm text-body-sm text-xs text-on-surface-variant">
                            Speaker feedback
                          </span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.spokenReplies}
                            onChange={(e) =>
                              setFormData({ ...formData, spokenReplies: e.target.checked })
                            }
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-surface-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-container"></div>
                        </label>
                      </div>

                      {/* Speed Selector Pills */}
                      <div className="flex flex-col gap-1">
                        <span className="font-label-sm text-label-sm uppercase font-bold text-on-surface-variant">
                          Voice Speed
                        </span>
                        <div className="inline-flex bg-surface-container p-0.5 rounded border border-on-primary-fixed/15">
                          {(['Slow', 'Normal', 'Fast'] as const).map((spd) => (
                            <button
                              key={spd}
                              type="button"
                              onClick={() => setFormData({ ...formData, voiceSpeed: spd })}
                              className={`flex-1 py-1 px-2 font-label-sm text-label-sm rounded transition-all ${
                                formData.voiceSpeed === spd
                                  ? 'bg-primary-container text-surface-container-lowest font-bold shadow-xs'
                                  : 'text-on-surface-variant hover:text-on-surface'
                              }`}
                            >
                              {spd}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Audio Volume Slider */}
                      <div className="flex flex-col gap-1">
                        <div className="flex justify-between items-center">
                          <span className="font-label-sm text-label-sm uppercase font-bold text-on-surface-variant">
                            Audio Volume
                          </span>
                          <span className="font-label-sm text-label-sm font-bold text-on-primary-fixed">
                            {formData.voiceVolume}%
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-sm text-on-surface-variant">
                            volume_down
                          </span>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={formData.voiceVolume}
                            onChange={(e) =>
                              setFormData({ ...formData, voiceVolume: Number(e.target.value) })
                            }
                            className="w-full h-1.5 bg-surface-variant rounded-lg appearance-none cursor-pointer accent-[#0F0F56]"
                          />
                          <span className="material-symbols-outlined text-sm text-on-surface-variant">
                            volume_up
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Section 3: Shop Details Form */}
                  <div className="flex flex-col gap-5">
                    {/* Notice Box */}
                    <div className="bg-[#FDDBA4]/40 rounded-lg p-3.5 border border-[#0F0F56]/20 flex items-start gap-3">
                      <span className="material-symbols-outlined text-on-primary-fixed text-xl shrink-0 mt-0.5">
                        info
                      </span>
                      <p className="font-body-sm text-body-sm text-on-surface leading-snug">
                        <strong className="font-bold text-on-primary-fixed">Note:</strong> Shop Name,
                        Phone, and Address will be automatically printed on daily sales slips, digital GST
                        invoices, and bills dispatched to customers via WhatsApp.
                      </p>
                    </div>

                    {/* Input Fields Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                      {/* Shop Name */}
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="shop-name-input"
                          className="font-label-md text-label-md uppercase tracking-wider text-on-primary-fixed font-bold"
                        >
                          Shop Name <span className="text-error">*</span>
                        </label>
                        <div className="relative">
                          <input
                            id="shop-name-input"
                            type="text"
                            value={formData.shopName}
                            onChange={(e) => setFormData({ ...formData, shopName: e.target.value })}
                            className="w-full bg-surface-container-lowest border border-on-primary-fixed/30 rounded-sm px-3.5 py-2 font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container"
                          />
                          <span className="material-symbols-outlined absolute right-3 top-2.5 text-on-surface-variant text-base pointer-events-none">
                            storefront
                          </span>
                        </div>
                      </div>

                      {/* Owner Name */}
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="owner-name-input"
                          className="font-label-md text-label-md uppercase tracking-wider text-on-primary-fixed font-bold"
                        >
                          Owner / Proprietor Name <span className="text-error">*</span>
                        </label>
                        <div className="relative">
                          <input
                            id="owner-name-input"
                            type="text"
                            value={formData.ownerName}
                            onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
                            className="w-full bg-surface-container-lowest border border-on-primary-fixed/30 rounded-sm px-3.5 py-2 font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container"
                          />
                          <span className="material-symbols-outlined absolute right-3 top-2.5 text-on-surface-variant text-base pointer-events-none">
                            person
                          </span>
                        </div>
                      </div>

                      {/* Mobile / WhatsApp Number */}
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="phone-input"
                          className="font-label-md text-label-md uppercase tracking-wider text-on-primary-fixed font-bold"
                        >
                          Mobile / WhatsApp Number <span className="text-error">*</span>
                        </label>
                        <div className="flex items-center">
                          <div className="flex items-center gap-1.5 bg-surface-container-high px-3 py-2 border border-r-0 border-on-primary-fixed/30 rounded-l-sm text-on-surface shrink-0">
                            <span className="font-label-md text-label-md font-bold">🇮🇳 +91</span>
                          </div>
                          <input
                            id="phone-input"
                            type="text"
                            value={formData.phone}
                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                            className="w-full bg-surface-container-lowest border border-on-primary-fixed/30 rounded-r-sm px-3.5 py-2 font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container"
                          />
                        </div>
                      </div>

                      {/* Store Category / Trade Type */}
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="trade-type-select"
                          className="font-label-md text-label-md uppercase tracking-wider text-on-primary-fixed font-bold"
                        >
                          Store Category / Trade Type
                        </label>
                        <div className="relative">
                          <select
                            id="trade-type-select"
                            value={formData.businessDomain}
                            onChange={(e) =>
                              setFormData({ ...formData, businessDomain: e.target.value })
                            }
                            className="w-full bg-surface-container-lowest border border-on-primary-fixed/30 rounded-sm px-3 py-2 font-body-md text-body-md text-on-surface appearance-none focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container pr-10"
                          >
                            <option>Kirana / Provision Store</option>
                            <option>Grocery</option>
                            <option>Medical &amp; Pharmacy</option>
                            <option>Fruits &amp; Vegetables</option>
                            <option>Bakery &amp; Sweet Stall</option>
                            <option>Dairy &amp; Milk Booth</option>
                            <option>Fancy &amp; Stationery Store</option>
                          </select>
                          <span className="material-symbols-outlined absolute right-2.5 top-2.5 pointer-events-none text-on-primary-fixed text-lg">
                            expand_more
                          </span>
                        </div>
                      </div>

                      {/* GST Number */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <label
                            htmlFor="gst-input"
                            className="font-label-md text-label-md uppercase tracking-wider text-on-primary-fixed font-bold"
                          >
                            GSTIN / Tax ID (Optional)
                          </label>
                          <span className="font-label-sm text-label-sm text-on-surface-variant font-medium">
                            Composition Scheme
                          </span>
                        </div>
                        <div className="relative">
                          <input
                            id="gst-input"
                            type="text"
                            value={formData.gstNumber}
                            onChange={(e) =>
                              setFormData({ ...formData, gstNumber: e.target.value.toUpperCase() })
                            }
                            className="w-full bg-surface-container-lowest border border-on-primary-fixed/30 rounded-sm px-3.5 py-2 font-body-md text-body-md text-on-surface uppercase tracking-wider focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container"
                          />
                          <span className="material-symbols-outlined absolute right-3 top-2.5 text-on-surface-variant text-base pointer-events-none">
                            receipt
                          </span>
                        </div>
                      </div>

                      {/* Trade License / FSSAI */}
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="fssai-input"
                          className="font-label-md text-label-md uppercase tracking-wider text-on-primary-fixed font-bold"
                        >
                          FSSAI Food License #
                        </label>
                        <div className="relative">
                          <input
                            id="fssai-input"
                            type="text"
                            value={formData.fssaiNumber}
                            onChange={(e) => setFormData({ ...formData, fssaiNumber: e.target.value })}
                            className="w-full bg-surface-container-lowest border border-on-primary-fixed/30 rounded-sm px-3.5 py-2 font-body-md text-body-md text-on-surface tracking-wider focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container"
                          />
                          <span className="material-symbols-outlined absolute right-3 top-2.5 text-on-surface-variant text-base pointer-events-none">
                            verified_user
                          </span>
                        </div>
                      </div>

                      {/* Complete Shop Address (Full Span) */}
                      <div className="md:col-span-2 flex flex-col gap-1.5">
                        <label
                          htmlFor="address-input"
                          className="font-label-md text-label-md uppercase tracking-wider text-on-primary-fixed font-bold"
                        >
                          Complete Shop Address (For Paper &amp; SMS Invoices){' '}
                          <span className="text-error">*</span>
                        </label>
                        <textarea
                          id="address-input"
                          rows={2}
                          value={formData.address}
                          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                          className="w-full bg-surface-container-lowest border border-on-primary-fixed/30 rounded-sm p-3 font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section 4: Operational Controls & Subsections Preview */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md pt-4 border-t border-on-primary-fixed/10">
                    {/* Data & Backup Card */}
                    <div
                      ref={sectionRefs['backup']}
                      className="bg-surface-container p-4 rounded-xl border border-on-primary-fixed/15 flex flex-col justify-between gap-3"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <span className="font-label-md text-label-md uppercase tracking-wider text-on-primary-fixed font-bold flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-base">cloud_done</span>{' '}
                            Daily Khata Cloud Backup
                          </span>
                          <span className="font-label-sm text-label-sm bg-tertiary-fixed text-on-tertiary-fixed px-2 py-0.5 rounded font-bold">
                            ENCRYPTED
                          </span>
                        </div>
                        <p className="font-body-sm text-body-sm text-on-surface-variant text-xs mt-1">
                          Last backup:{' '}
                          <strong className="text-on-surface font-semibold">Today at 2:15 PM</strong>{' '}
                          (Local flash memory &amp; Google Drive).
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={handleBackupNow}
                          className="bg-secondary-container text-on-primary-fixed font-label-md text-label-md px-3.5 py-1.5 rounded-sm border border-primary-container shadow-[1.5px_1.5px_0px_#0F0F56] hover:bg-secondary-fixed active:translate-y-0.5 transition-all font-bold flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-sm">sync</span> Back up now
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadBackup}
                          className="bg-surface-container-lowest text-on-surface font-label-md text-label-md px-3 py-1.5 rounded-sm border border-on-primary-fixed/20 hover:bg-surface-container-high transition-all flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-sm">download</span> Download
                          PDF/Excel
                        </button>
                      </div>
                    </div>

                    {/* WhatsApp & Notifications */}
                    <div
                      ref={sectionRefs['notifications']}
                      className="bg-surface-container p-4 rounded-xl border border-on-primary-fixed/15 flex flex-col justify-between gap-3"
                    >
                      <div className="flex flex-col gap-2">
                        <span className="font-label-md text-label-md uppercase tracking-wider text-on-primary-fixed font-bold flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-base">send_to_mobile</span>{' '}
                          Automated Customer Alerts
                        </span>
                        <div className="flex flex-col gap-2 pt-1">
                          <label className="flex items-center justify-between cursor-pointer">
                            <span className="font-body-sm text-body-sm text-on-surface text-xs">
                              Daily 9:00 PM Khata ledger PDF to Owner
                            </span>
                            <input
                              type="checkbox"
                              checked={formData.dailyLedgerPdf}
                              onChange={(e) =>
                                setFormData({ ...formData, dailyLedgerPdf: e.target.checked })
                              }
                              className="w-4 h-4 rounded-sm text-primary-container accent-[#0F0F56]"
                            />
                          </label>
                          <label className="flex items-center justify-between cursor-pointer">
                            <span className="font-body-sm text-body-sm text-on-surface text-xs">
                              Low-stock warning alert on WhatsApp
                            </span>
                            <input
                              type="checkbox"
                              checked={formData.lowStockAlert}
                              onChange={(e) =>
                                setFormData({ ...formData, lowStockAlert: e.target.checked })
                              }
                              className="w-4 h-4 rounded-sm text-primary-container accent-[#0F0F56]"
                            />
                          </label>
                          <label className="flex items-center justify-between cursor-pointer">
                            <span className="font-body-sm text-body-sm text-on-surface text-xs">
                              Automatic payment reminder to customers
                            </span>
                            <input
                              type="checkbox"
                              checked={formData.paymentReminder}
                              onChange={(e) =>
                                setFormData({ ...formData, paymentReminder: e.target.checked })
                              }
                              className="w-4 h-4 rounded-sm text-primary-container accent-[#0F0F56]"
                            />
                          </label>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <span className="font-label-sm text-label-sm bg-[#DEC3EB] text-primary-container px-2 py-0.5 rounded font-bold">
                          120 WhatsApp Credits Remaining
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* App Preferences, Account Security & About Preview */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md pt-4 border-t border-on-primary-fixed/10">
                    {/* App Preferences */}
                    <div
                      ref={sectionRefs['preferences']}
                      className="bg-surface-container p-4 rounded-xl border border-on-primary-fixed/15 flex flex-col justify-between gap-3"
                    >
                      <div className="flex flex-col gap-1.5">
                        <span className="font-label-md text-label-md uppercase tracking-wider text-on-primary-fixed font-bold flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-base">display_settings</span>{' '}
                          App Preferences
                        </span>
                        <p className="font-body-sm text-body-sm text-on-surface-variant text-xs">
                          Display density, vernacular numbers, and thermal printer slip templates.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => showToast('App Preferences: Compact grid and Marathi numerals active.')}
                        className="bg-surface-container-lowest text-on-surface font-label-md text-label-md px-3 py-1.5 rounded-sm border border-on-primary-fixed/20 hover:bg-surface-container-high transition-all text-left flex items-center justify-between"
                      >
                        <span>Configure Slip Formats</span>
                        <span className="material-symbols-outlined text-sm">chevron_right</span>
                      </button>
                    </div>

                    {/* Account & Security */}
                    <div
                      ref={sectionRefs['security']}
                      className="bg-surface-container p-4 rounded-xl border border-on-primary-fixed/15 flex flex-col justify-between gap-3"
                    >
                      <div className="flex flex-col gap-1.5">
                        <span className="font-label-md text-label-md uppercase tracking-wider text-on-primary-fixed font-bold flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-base">lock_person</span>{' '}
                          Security &amp; PIN
                        </span>
                        <p className="font-body-sm text-body-sm text-on-surface-variant text-xs">
                          Counter 4-digit lock PIN and biometric fingerprint authorization.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => showToast('Counter PIN change requires SMS OTP.')}
                        className="bg-surface-container-lowest text-on-surface font-label-md text-label-md px-3 py-1.5 rounded-sm border border-on-primary-fixed/20 hover:bg-surface-container-high transition-all text-left flex items-center justify-between"
                      >
                        <span>Update Counter PIN</span>
                        <span className="material-symbols-outlined text-sm">key</span>
                      </button>
                    </div>

                    {/* About CHOTU.ai */}
                    <div
                      ref={sectionRefs['about']}
                      className="bg-surface-container p-4 rounded-xl border border-on-primary-fixed/15 flex flex-col justify-between gap-3"
                    >
                      <div className="flex flex-col gap-1.5">
                        <span className="font-label-md text-label-md uppercase tracking-wider text-on-primary-fixed font-bold flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-base">info</span> About
                          CHOTU.ai
                        </span>
                        <p className="font-body-sm text-body-sm text-on-surface-variant text-xs">
                          Version 2.4.0 (Build Bengaluru 2.0).
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          to="/terms"
                          className="text-xs font-label-md text-primary-container hover:underline"
                        >
                          Terms
                        </Link>
                        <span className="text-on-surface-variant text-xs">•</span>
                        <Link
                          to="/privacy"
                          className="text-xs font-label-md text-primary-container hover:underline"
                        >
                          Privacy
                        </Link>
                        <span className="text-on-surface-variant text-xs">•</span>
                        <a
                          href="https://chotu.ai"
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-label-md text-primary-container hover:underline"
                        >
                          Website
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* Section 5: Save & Action Bar (Bottom Confirmation) */}
                  <div className="pt-4 border-t border-on-primary-fixed/15 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-2 text-on-surface-variant">
                      <span className="material-symbols-outlined text-base text-primary-container">
                        check_circle
                      </span>
                      <span className="font-body-sm text-body-sm text-xs">
                        All edits instantly sync with counter mic terminal &amp; POS billing app.
                      </span>
                    </div>
                    <div className="flex items-center gap-3 w-full sm:w-auto">
                      <button
                        type="button"
                        onClick={handleDiscard}
                        disabled={isSaving}
                        className="w-1/2 sm:w-auto px-5 py-2.5 rounded-sm bg-surface-container-high text-on-surface font-label-md text-label-md border border-on-primary-fixed/20 hover:bg-surface-container-highest transition-colors font-bold uppercase tracking-wider disabled:opacity-50"
                      >
                        Discard
                      </button>
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={isSaving}
                        className="w-1/2 sm:w-auto px-7 py-2.5 rounded-sm bg-primary-container text-surface-container-lowest font-label-md text-label-md border border-primary-container shadow-[2px_2px_0px_#0F0F56] hover:translate-y-0.5 active:translate-y-0.5 transition-all font-bold uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-base">
                          {isSaving ? 'sync' : 'save'}
                        </span>
                        {isSaving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>

      <AuthToast text={toastText} show={toastShow} />
    </>
  );
}
