import type { Session } from './api';

const KEY = 'chotu.session';

/** Session lives in localStorage ("Remember counter device") or sessionStorage. */
export function saveSession(session: Session, remember: boolean): void {
  clearSession();
  (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(session));
}

export function getSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export function updateSessionUser(updates: Partial<Session['user']>): Session | null {
  const session = getSession();
  if (!session) return null;
  const updated: Session = { ...session, user: { ...session.user, ...updates } };
  try {
    if (localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify(updated));
    if (sessionStorage.getItem(KEY)) sessionStorage.setItem(KEY, JSON.stringify(updated));
  } catch {
    /* storage unavailable */
  }
  return updated;
}
