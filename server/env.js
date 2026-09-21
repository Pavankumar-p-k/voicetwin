// env.js — MUST be the first import in server/index.js.
// Parses .env into process.env synchronously at module-evaluation time,
// BEFORE config.js snapshots process.env (static imports evaluate in order,
// so this file has to come first). This is why PORT/caps from .env apply.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_ENV !== 'test' && !process.env.ASSEMBLYAI_API_KEY) {
  const envPath = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}
