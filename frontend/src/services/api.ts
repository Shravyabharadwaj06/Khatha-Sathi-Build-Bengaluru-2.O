/**
 * API layer for the CHOTU.ai frontend.
 *
 * Every screen talks to the backend ONLY through the functions exported here.
 * - VITE_USE_MOCK_API=true  -> in-browser mock (localStorage), small fake delay.
 * - VITE_USE_MOCK_API=false -> fetch() against VITE_API_BASE_URL.
 *
 * Backend team: the REST paths/payloads in `real` are a proposal — change them
 * here and nowhere else.
 */
import { clearSession, getSession, replaceSession } from './session';
import { ApiError } from './errors';
import { voiceMock } from './voiceMock';
import type {
  VoiceCancelResult,
  VoiceCommandInput,
  VoiceConfirmResult,
  VoiceLanguage,
  VoiceResponse,
  VoiceUsage,
} from '../types/voice';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string; // 10 digits, no +91
  city: string;
  businessDomain: string;
  shopName?: string;
  gstNumber?: string;
  fssaiNumber?: string;
  address?: string;
}

export interface Session {
  token: string;
  /** Supabase refresh token (real backend); used to renew `token` when it expires. */
  refreshToken?: string;
  /** Unix seconds when `token` expires (real backend). */
  expiresAt?: number;
  user: User;
}

export interface SignupInput {
  email: string;
  name: string;
  phone: string;
  otp: string;
  password: string;
  city: string;
  businessDomain: string;
}

export interface LoginInput {
  method: 'phone' | 'email';
  identifier: string; // 10-digit phone or email
  password: string;
}

export interface ProfileInput {
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

export interface IssueReportInput {
  categories: string[];
  description: string;
  contactAllowed: boolean;
  attachments: File[];
}

export interface IssueReport {
  id: string;
  reference: string;
  categories: string[];
  description: string;
  contactAllowed: boolean;
  attachments: Array<{ name: string; type: string; size: number }>;
  createdAt: string;
}

export { ApiError };

export const USE_MOCK_API = import.meta.env.VITE_USE_MOCK_API !== 'false';
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');

// ---------------------------------------------------------------------------
// Real implementation
// ---------------------------------------------------------------------------
function requestHeaders(init: RequestInit, token?: string): HeadersInit {
  const isMultipart = init.body instanceof FormData;
  return {
    ...(!isMultipart && init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...init.headers,
  };
}

/** Turns any backend error body into an ApiError: `{detail}`, `{message, field}` or the voice contract's `{error: {code, message}}`. */
function apiError(res: Response, body: Record<string, unknown>): ApiError {
  const err = body.error && typeof body.error === 'object' ? (body.error as { code?: string; message?: string }) : undefined;
  const detail = typeof body.detail === 'string'
    ? body.detail
    : Array.isArray(body.detail)
      ? body.detail.map((issue: { msg?: string }) => issue.msg).filter(Boolean).join(', ')
      : undefined;
  return new ApiError(
    err?.message ?? (typeof body.message === 'string' ? body.message : undefined) ?? detail ?? `Request failed (${res.status})`,
    typeof body.field === 'string' ? body.field : res.headers.get('X-Error-Field') ?? undefined,
    err?.code ?? (res.status === 401 ? 'UNAUTHORIZED' : undefined),
    res.status,
  );
}

let refreshInFlight: Promise<Session> | undefined;

/** One refresh at a time; concurrent 401s wait for the same refresh. */
async function refreshSession(refreshToken: string): Promise<Session> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        clearSession();
        throw apiError(res, body);
      }
      const session = body as Session;
      replaceSession(session);
      return session;
    })().finally(() => {
      refreshInFlight = undefined;
    });
  }
  return refreshInFlight;
}

const noRefreshPaths = new Set(['/auth/login', '/auth/signup', '/auth/refresh', '/auth/logout', '/auth/otp/send', '/auth/otp/verify']);

/** fetch with the login token; on 401 it refreshes the Supabase session once and retries. */
async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let session = getSession();
  const send = (token?: string) => fetch(`${BASE_URL}${path}`, { ...init, headers: requestHeaders(init, token) });
  let res = await send(session?.token);
  if (res.status === 401 && session?.refreshToken && !noRefreshPaths.has(path)) {
    session = await refreshSession(session.refreshToken);
    res = await send(session.token);
  }
  if (res.status === 401 && session?.refreshToken && !noRefreshPaths.has(path)) clearSession();
  return res;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authedFetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError(res, body);
  return body as T;
}

/** Authenticated JSON request to any backend path (used by the Products / Customers pages). */
export const apiRequest = <T,>(path: string, init: RequestInit = {}): Promise<T> => request<T>(path, init);

const real = {
  sendOtp: (phone: string) => request<{ sent: true }>('/auth/otp/send', { method: 'POST', body: JSON.stringify({ phone }) }),
  verifyOtp: (phone: string, otp: string) =>
    request<{ verified: boolean }>('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ phone, otp }) }),
  signup: (input: SignupInput) => request<Session>('/auth/signup', { method: 'POST', body: JSON.stringify(input) }),
  login: (input: LoginInput) => request<Session>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  getCurrentUser: () => request<User>('/auth/me'),
  updateProfile: (input: ProfileInput) => request<User>('/auth/profile', { method: 'PUT', body: JSON.stringify(input) }),
  createIssueReport(input: IssueReportInput) {
    const body = new FormData();
    body.set('categories', JSON.stringify(input.categories));
    body.set('description', input.description);
    body.set('contactAllowed', String(input.contactAllowed));
    input.attachments.forEach((file) => body.append('attachments', file, file.name));
    return request<IssueReport>('/support/reports', { method: 'POST', body });
  },
  listIssueReports: () => request<IssueReport[]>('/support/reports'),
};

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------
const MOCK_DELAY_MS = 400;
const MOCK_USERS_KEY = 'chotu.mock.users';
const MOCK_ISSUE_REPORTS_KEY = 'chotu.mock.issue-reports';
const delay = <T,>(value: T) => new Promise<T>((r) => setTimeout(() => r(value), MOCK_DELAY_MS));

type MockUser = User & { password: string };

/** Demo account so the app can be shown without signing up first. */
const DEMO_USER: MockUser = {
  id: 'demo',
  name: 'Demo Shop',
  email: 'demo@chotu.shop',
  phone: '9876543210',
  city: 'Bengaluru',
  businessDomain: 'Grocery',
  password: '123456',
};

function readUsers(): MockUser[] {
  try {
    const list = JSON.parse(localStorage.getItem(MOCK_USERS_KEY) ?? '[]') as MockUser[];
    return [DEMO_USER, ...list];
  } catch {
    return [DEMO_USER];
  }
}

function writeUser(user: MockUser) {
  const list = readUsers().filter((u) => u.id !== DEMO_USER.id);
  localStorage.setItem(MOCK_USERS_KEY, JSON.stringify([...list, user]));
}

function readIssueReports(): IssueReport[] {
  try {
    return JSON.parse(localStorage.getItem(MOCK_ISSUE_REPORTS_KEY) ?? '[]') as IssueReport[];
  } catch {
    return [];
  }
}

const sentOtps = new Set<string>();
const strip = ({ password: _password, ...user }: MockUser): User => {
  void _password;
  return user;
};
const token = (id: string) => `mock.${id}.${Date.now()}`;

const mock = {
  async sendOtp(phone: string) {
    sentOtps.add(phone);
    return delay({ sent: true as const });
  },
  /** Mock accepts any 6-digit code once an OTP was sent to that phone. */
  async verifyOtp(phone: string, otp: string) {
    return delay({ verified: sentOtps.has(phone) && /^\d{6}$/.test(otp) });
  },
  async signup(input: SignupInput) {
    const users = readUsers();
    if (users.some((u) => u.email.toLowerCase() === input.email.toLowerCase()))
      throw new ApiError('An account with this email already exists.', 'email');
    if (users.some((u) => u.phone === input.phone))
      throw new ApiError('An account with this phone number already exists.', 'phone');
    const user: MockUser = {
      id: crypto.randomUUID(),
      name: input.name,
      email: input.email,
      phone: input.phone,
      city: input.city,
      businessDomain: input.businessDomain,
      password: input.password,
    };
    writeUser(user);
    return delay<Session>({ token: token(user.id), user: strip(user) });
  },
  async login(input: LoginInput) {
    const id = input.identifier.trim().toLowerCase();
    const user = readUsers().find((u) => (input.method === 'phone' ? u.phone === id : u.email.toLowerCase() === id));
    await delay(null);
    if (!user || user.password !== input.password)
      throw new ApiError('Incorrect login details or password / PIN.', 'password');
    return { token: token(user.id), user: strip(user) } satisfies Session;
  },
  async logout() {
    return delay(undefined);
  },
  async getCurrentUser() {
    const session = getSession();
    if (!session) throw new ApiError('Not logged in.');
    return delay(session.user);
  },
  async updateProfile(input: ProfileInput) {
    const session = getSession();
    if (!session) throw new ApiError('Not logged in.');
    const updated: User = {
      ...session.user,
      name: input.ownerName,
      phone: input.phone.replace(/\D/g, '').slice(-10),
      businessDomain: input.businessDomain,
      shopName: input.shopName,
      gstNumber: input.gstNumber,
      fssaiNumber: input.fssaiNumber,
      address: input.address,
    };
    const users = readUsers();
    const stored = users.find((user) => user.id === updated.id);
    if (stored && stored.id !== DEMO_USER.id) writeUser({ ...stored, ...updated });
    return delay(updated);
  },
  async createIssueReport(input: IssueReportInput) {
    const reports = readIssueReports();
    const report: IssueReport = {
      id: crypto.randomUUID(),
      reference: `CH-${2041 + reports.length}`,
      categories: input.categories,
      description: input.description.trim(),
      contactAllowed: input.contactAllowed,
      attachments: input.attachments.map(({ name, type, size }) => ({ name, type, size })),
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem(MOCK_ISSUE_REPORTS_KEY, JSON.stringify([report, ...reports]));
    return delay(report);
  },
  async listIssueReports() {
    return delay(readIssueReports());
  },
};

const impl = USE_MOCK_API ? mock : real;

export const sendOtp = (phone: string): Promise<{ sent: true }> => impl.sendOtp(phone);
export const verifyOtp = (phone: string, otp: string): Promise<{ verified: boolean }> => impl.verifyOtp(phone, otp);
export const signup = (input: SignupInput): Promise<Session> => impl.signup(input);
export const login = (input: LoginInput): Promise<Session> => impl.login(input);
export const logout = (): Promise<void> => impl.logout();
export const getCurrentUser = (): Promise<User> => impl.getCurrentUser();
export const updateProfile = (input: ProfileInput): Promise<User> => impl.updateProfile(input);
export const createIssueReport = (input: IssueReportInput): Promise<IssueReport> => impl.createIssueReport(input);
export const listIssueReports = (): Promise<IssueReport[]> => impl.listIssueReports();

// ---------------------------------------------------------------------------
// Voice assistant (contract: docs/VOICE_CONTRACT.md). Money is integer paise.
// ---------------------------------------------------------------------------

/** 'gnani': record audio and send it to the backend (default). 'browser': Web Speech API, send text (no credits). */
export const VOICE_INPUT_MODE: 'gnani' | 'browser' = import.meta.env.VITE_VOICE_INPUT === 'browser' ? 'browser' : 'gnani';

async function voiceFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await authedFetch(path, init);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('Cannot reach the server. Check the internet connection.', undefined, 'NETWORK');
  }
  if (!res.ok) throw apiError(res, await res.json().catch(() => ({})));
  return res;
}

const voiceJson = async <T,>(path: string, init: RequestInit = {}): Promise<T> => (await voiceFetch(path, init)).json() as Promise<T>;
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

const AUDIO_EXT: Record<string, string> = { 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'audio/flac': 'flac' };

const realVoice = {
  command(input: VoiceCommandInput) {
    const body = new FormData();
    body.set('language', input.language);
    if (input.text) body.set('text', input.text);
    else if (input.audio) {
      const type = input.audio.type.split(';')[0];
      body.set('audio', input.audio, `clip.${AUDIO_EXT[type] ?? 'wav'}`);
    }
    if (input.draftId) body.set('draft_id', input.draftId);
    return voiceJson<VoiceResponse>('/voice/command', { method: 'POST', body });
  },
  choose: (clarifyId: string, optionId: string) => voiceJson<VoiceResponse>('/voice/choose', post({ clarify_id: clarifyId, option_id: optionId })),
  confirm: (draftId: string) => voiceJson<VoiceConfirmResult>('/voice/confirm', post({ draft_id: draftId })),
  cancel: (draftId: string) => voiceJson<VoiceCancelResult>('/voice/cancel', post({ draft_id: draftId })),
  undo: (entryId: string, _language: VoiceLanguage) => {
    void _language;
    return voiceJson<VoiceResponse>('/voice/undo', post({ entry_id: entryId }));
  },
  speak: async (text: string, language: VoiceLanguage) => (await voiceFetch('/voice/speak', post({ text, language }))).blob(),
  usage: () => voiceJson<VoiceUsage>('/voice/usage'),
};

const voiceImpl = USE_MOCK_API ? voiceMock : realVoice;

/** Send a recorded clip or text. Returns a draft, a question (clarify), an answer or an error. Never saves. */
export const voiceCommand = (input: VoiceCommandInput): Promise<VoiceResponse> => voiceImpl.command(input);
/** Answer a clarify question (e.g. which Ravi). */
export const voiceChoose = (clarifyId: string, optionId: string): Promise<VoiceResponse> => voiceImpl.choose(clarifyId, optionId);
/** The ONLY call that saves anything. */
export const voiceConfirm = (draftId: string): Promise<VoiceConfirmResult> => voiceImpl.confirm(draftId);
export const voiceCancel = (draftId: string): Promise<VoiceCancelResult> => voiceImpl.cancel(draftId);
/** Returns a reversal DRAFT for a saved entry; it still needs voiceConfirm. */
export const voiceUndo = (entryId: string, language: VoiceLanguage): Promise<VoiceResponse> => voiceImpl.undo(entryId, language);
/** Spoken reply audio (MP3/WAV). Callers fall back to speechSynthesis on any error. */
export const voiceSpeak = (text: string, language: VoiceLanguage): Promise<Blob> => voiceImpl.speak(text, language);
export const voiceUsage = (): Promise<VoiceUsage> => voiceImpl.usage();
