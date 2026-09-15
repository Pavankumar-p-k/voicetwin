// Parse-only verification: runs `node --check` on every .js file.
// Does NOT execute any file, so server side effects are never triggered.
// Usage: node tools/syntax-check.js
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      await walk(p, out);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      out.push(p);
    }
  }
  return out;
}

const files = await walk(ROOT);
let failed = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (res.status !== 0) {
    console.error(`SYNTAX ERROR: ${rel}\n${res.stderr}`);
    failed++;
  } else {
    console.log(`ok  ${rel}`);
  }
}
if (failed > 0) {
  console.error(`\n${failed} file(s) failed.`);
  process.exit(1);
}
console.log(`\nOK: ${files.length} JS files parsed, no syntax errors.`);
