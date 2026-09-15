// Mints single-use temporary tokens for the browser.
// GET https://agents.assemblyai.com/v1/token
//   ?expires_in_seconds=..&max_session_duration_seconds=..
//   Authorization: Bearer <API KEY>
// The permanent API key never leaves this process.
import { CONFIG } from '../config.js';

export async function mintToken() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY is not set. Copy .env.example to .env and paste your key.');

  const url = new URL(CONFIG.AAI.TOKEN_URL);
  url.searchParams.set('expires_in_seconds', String(CONFIG.LIMITS.TOKEN_EXPIRES_SECONDS));
  url.searchParams.set('max_session_duration_seconds', String(CONFIG.LIMITS.MAX_SESSION_SECONDS));

  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`token endpoint ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.token) throw new Error('token endpoint returned no token');
  return {
    token: data.token,
    expiresIn: CONFIG.LIMITS.TOKEN_EXPIRES_SECONDS,
    maxSessionSeconds: CONFIG.LIMITS.MAX_SESSION_SECONDS,
  };
}
