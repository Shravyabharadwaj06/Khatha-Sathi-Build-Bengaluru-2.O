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
import { getSession } from './session';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string; // 10 digits, no +91
  city: string;
  businessDomain: string;
}

export interface Session {
  token: string;
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

export class ApiError extends Error {
  constructor(
    message: string,
    /** Form field the error belongs to, when applicable. */
    public field?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const USE_MOCK_API = import.meta.env.VITE_USE_MOCK_API !== 'false';
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

// ---------------------------------------------------------------------------
// Real implementation
// ---------------------------------------------------------------------------
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getSession()?.token;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(body.detail)
      ? body.detail.map((item: { msg?: string }) => item.msg).filter(Boolean).join(', ')
      : body.detail;
    throw new ApiError(detail || body.message || `Request failed (${res.status})`, body.field);
  }
  return body as T;
}

const real = {
  sendOtp: (phone: string) => request<{ sent: true }>('/auth/otp/send', { method: 'POST', body: JSON.stringify({ phone }) }),
  verifyOtp: (phone: string, otp: string) =>
    request<{ verified: boolean }>('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ phone, otp }) }),
  signup: (input: SignupInput) => request<Session>('/auth/signup', { method: 'POST', body: JSON.stringify(input) }),
  login: (input: LoginInput) => request<Session>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  getCurrentUser: () => request<User>('/auth/me'),
};

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------
const MOCK_DELAY_MS = 400;
const MOCK_USERS_KEY = 'chotu.mock.users';
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
};

const impl = USE_MOCK_API ? mock : real;

export const sendOtp = (phone: string): Promise<{ sent: true }> => impl.sendOtp(phone);
export const verifyOtp = (phone: string, otp: string): Promise<{ verified: boolean }> => impl.verifyOtp(phone, otp);
export const signup = (input: SignupInput): Promise<Session> => impl.signup(input);
export const login = (input: LoginInput): Promise<Session> => impl.login(input);
export const logout = (): Promise<void> => impl.logout();
export const getCurrentUser = (): Promise<User> => impl.getCurrentUser();
