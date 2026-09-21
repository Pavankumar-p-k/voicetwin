// auth.js — minimal Supabase Auth client (raw REST, no SDK).
// Google + magic-link login, persistent localStorage session, logout.
// Access tokens go out as Authorization: Bearer on every protected call;
// user_id is ALWAYS derived server-side from the verified token.
const SESS_KEY = 'vt:auth';
let cfgCache = null;

export async function getConfig() {
  if (cfgCache) return cfgCache;
  const r = await fetch('/api/config');
  if (!r.ok) throw new Error('auth not configured');
  cfgCache = await r.json();
  if (!cfgCache.supabaseUrl || !cfgCache.supabaseAnonKey) throw new Error('auth not configured');
  return cfgCache;
}

export function session() {
  try {
    const s = JSON.parse(localStorage.getItem(SESS_KEY) || 'null');
    return s && s.access_token ? s : null;
  } catch { return null; }
}

function saveSession(s) {
  try {
    if (s) localStorage.setItem(SESS_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESS_KEY);
  } catch {}
}

export function getToken() {
  const s = session();
  return s ? s.access_token : null;
}

export function getUser() {
  const s = session();
  return s ? s.user || null : null;
}

// Refresh proactively when expiring within a minute.
export async function ensureToken() {
  const s = session();
  if (!s) return null;
  if (s.expires_at && s.expires_at * 1000 > Date.now() + 60_000) return s.access_token;
  if (!s.refresh_token) return s.access_token;
  try {
    const { supabaseUrl, supabaseAnonKey } = await getConfig();
    const r = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!r.ok) return s.access_token; // let the API call 401 naturally
    const d = await r.json();
    const next = { ...s, access_token: d.access_token, refresh_token: d.refresh_token || s.refresh_token, expires_at: d.expires_at };
    saveSession(next);
    try {
      const u = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${next.access_token}` },
      }).then((x) => (x.ok ? x.json() : null));
      if (u) { next.user = { id: u.id, email: u.email || null }; saveSession(next); }
    } catch {}
    return next.access_token;
  } catch { return s.access_token; }
}

// fetch wrapper: adds auth, never sends user_id (server derives it).
export async function api(path, opts = {}) {
  const token = await ensureToken();
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(path, { ...opts, headers });
}

export async function loginWithGoogle() {
  const { supabaseUrl } = await getConfig();
  const redirect = `${location.origin}/auth-callback.html`;
  location.href = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}`;
}

export async function sendMagicLink(email) {
  const { supabaseUrl, supabaseAnonKey } = await getConfig();
  const r = await fetch(`${supabaseUrl}/auth/v1/otp`, {
    method: 'POST',
    headers: { apikey: supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, options: { email_redirect_to: `${location.origin}/auth-callback.html` } }),
  });
  if (!r.ok) throw new Error('Could not send magic link. Check the email and try again.');
}

function friendlyAuthError(code, fallback) {
  const m = {
    user_already_exists: 'Account already exists — switch to Log in.',
    UserAlreadyRegistered: 'Account already exists — switch to Log in.',
    invalid_credentials: 'Wrong email or password. Try again.',
    InvalidLoginCredentials: 'Wrong email or password. Try again.',
    email_not_confirmed: 'Confirm your email first, or turn off “Confirm email” in Supabase Auth settings.',
    EmailNotConfirmed: 'Confirm your email first, or turn off “Confirm email” in Supabase Auth settings.',
    weak_password: 'Password must be at least 6 characters.',
    WeakPassword: 'Password must be at least 6 characters.',
    validation_failed: 'That login method is not enabled in Supabase Auth settings.',
  };
  return m[code] || fallback;
}

async function storePasswordSession(d) {
  if (!d?.access_token) throw new Error('No session returned. Try again.');
  const s = {
    access_token: d.access_token,
    refresh_token: d.refresh_token || null,
    expires_at: d.expires_at || null,
    user: d.user ? { id: d.user.id, email: d.user.email || null } : null,
  };
  saveSession(s);
  return s;
}

// Email + password. Works with zero SMTP: needs only the Email provider ON.
// If Supabase requires email confirmation, signup returns no session and we
// say so plainly instead of failing mysteriously.
export async function signUp(email, password) {
  const { supabaseUrl, supabaseAnonKey } = await getConfig();
  const r = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(friendlyAuthError(d?.code || d?.error_code, d?.msg || d?.message || 'Sign-up failed.'));
  if (!d.session && !d.access_token) {
    throw new Error('Account created — check your email to confirm it, then Log in. (Or turn off “Confirm email” in Supabase to skip this.)');
  }
  const s = d.session || d;
  return storePasswordSession(s);
}

export async function signIn(email, password) {
  const { supabaseUrl, supabaseAnonKey } = await getConfig();
  const r = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(friendlyAuthError(d?.error_code || d?.code, d?.error_description || d?.msg || 'Login failed.'));
  return storePasswordSession(d);
}

export async function logout() {
  try {
    const s = session();
    if (s) {
      const { supabaseUrl, supabaseAnonKey } = await getConfig();
      await fetch(`${supabaseUrl}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${s.access_token}` },
      }).catch(() => {});
    }
  } finally {
    saveSession(null);
  }
}

// OAuth/magic-link landing: #access_token=…&refresh_token=… → store → home.
export async function handleAuthCallback() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const access_token = hash.get('access_token');
  const refresh_token = hash.get('refresh_token');
  const expires_at = Number(hash.get('expires_at') || 0) || null;
  if (!access_token) throw new Error('No session returned. Try logging in again.');
  const s = { access_token, refresh_token, expires_at, user: null };
  saveSession(s);
  try {
    const { supabaseUrl, supabaseAnonKey } = await getConfig();
    const u = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${access_token}` },
    }).then((r) => (r.ok ? r.json() : null));
    if (u) { s.user = { id: u.id, email: u.email || null }; saveSession(s); }
  } catch {}
  history.replaceState(null, '', location.pathname);
}
