// security-test.mjs — multi-user MVP gate checks. No secrets inside.
// Usage: node tools/security-test.mjs [baseUrl]
//   TOKEN=<supabase-access-token> node tools/security-test.mjs  (authed checks)
// Anonymous checks always run: every protected route must 401 without a token,
// public routes stay public, and no AssemblyAI key may leak anywhere.
const base = (process.argv[2] || 'http://localhost:5000').replace(/\/$/, '');
const TOKEN = process.env.TOKEN || null;
let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n} ${c ? '' : x}`); };
const j = async (method, path, body, token) => {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
};

console.log('== anonymous (must all 401/deny) ==');
for (const [m, p, b] of [
  ['GET', '/api/voice-token'], ['POST', '/api/interview/start', {}],
  ['GET', '/api/me/interviews'], ['GET', '/api/me/interviews/iv_nope'],
  ['POST', '/api/interview/answer', { interviewId: 'x' }],
  ['POST', '/api/interview/next', { interviewId: 'x' }],
  ['POST', '/api/interview/end', { interviewId: 'x' }],
]) {
  const r = await j(m, p, b, null);
  check(`${m} ${p} → 401`, r.status === 401, `got ${r.status}`);
}
const health = await j('GET', '/api/health');
check('health stays public', health.status === 200);
const cfg = await j('GET', '/api/config');
check('config public, no assembly secret', cfg.status === 200 && !JSON.stringify(cfg.data).toLowerCase().includes('assembly'));

if (TOKEN) {
  console.log('== authenticated ==');
  const sub = JSON.parse(Buffer.from(TOKEN.split('.')[1], 'base64').toString()).sub;
  let r = await j('POST', '/api/interview/start', { projectDescription: '' }, TOKEN);
  check('empty project → 400', r.status === 400, `got ${r.status}`);
  r = await j('POST', '/api/interview/start', { projectDescription: 'x'.repeat(5000) }, TOKEN);
  check('oversized project → 400', r.status === 400, `got ${r.status}`);
  r = await j('POST', '/api/interview/start', { projectDescription: 'Test project with Node and Redis for caching.', mode: 'bogus', user_id: 'forged-id', userId: 'forged' }, TOKEN);
  check('start works, bad mode coerced', r.status === 201, `got ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  const id = r.data?.interviewId;
  r = await j('GET', '/api/me/interviews', null, TOKEN);
  const mine = (r.data?.interviews || []).some((iv) => iv.id === id);
  check('forged user_id ignored (row is mine)', r.status === 200 && mine, `got ${r.status}`);
  r = await j('GET', '/api/me/interviews/does-not-exist', null, TOKEN);
  check('missing/other id → 404', r.status === 404, `got ${r.status}`);
  r = await j('GET', '/api/voice-token', null, TOKEN);
  check('voice-token mints (no key leaked)', r.status === 200 && r.data?.token && !JSON.stringify(r.data).toLowerCase().includes('assembly'), `got ${r.status}`);
} else {
  console.log('(skip authed checks: set TOKEN=<access-token>)');
}
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
