// auth.js — VOICETWIN user authentication (multi-user MVP).
// Documented Supabase approach: the browser logs in via Supabase Auth and
// sends its access token. We verify it against Supabase's own /auth/v1/user
// endpoint — no hand-rolled JWT crypto, no JWT secret, no custom passwords.
// Returns { id, email } or throws { status: 401 }.
const cache = new Map(); // token -> { user, exp } (tiny TTL, avoids re-verify storms)
const CACHE_TTL_MS = 60_000;

function authedFetch(url, token) {
  return fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY || '',
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function verifyUser(req) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!base || !process.env.SUPABASE_ANON_KEY) {
    const err = new Error('auth not configured');
    err.status = 503;
    throw err;
  }
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    const err = new Error('missing credentials');
    err.status = 401;
    throw err;
  }
  const token = m[1].trim();
  const now = Date.now();
  const hit = cache.get(token);
  if (hit && hit.exp > now) return hit.user;
  let res;
  try {
    res = await authedFetch(`${base}/auth/v1/user`, token);
  } catch {
    const err = new Error('auth service unreachable');
    err.status = 503;
    throw err;
  }
  if (res.status === 401 || res.status === 403) {
    cache.delete(token);
    const err = new Error('invalid or expired session');
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const err = new Error('auth verification failed');
    err.status = 503;
    throw err;
  }
  const data = await res.json();
  if (!data || !data.id) {
    const err = new Error('invalid session');
    err.status = 401;
    throw err;
  }
  const user = { id: data.id, email: data.email || null };
  if (cache.size > 5000) cache.clear();
  cache.set(token, { user, exp: now + CACHE_TTL_MS });
  return user;
}

export function dropCachedToken(req) {
  const h = req.headers?.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) cache.delete(m[1].trim());
}
