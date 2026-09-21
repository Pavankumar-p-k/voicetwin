// project-analyzer.js — ONE LLM project-analysis step per interview.
// Screen 1's description is distilled ONCE into a structured brief the
// interviewer reuses for every probe. Live turns never wait on analysis.
//
// Two paths, same schema:
//   1. LLM path (only if ANALYZER_* env is configured): a single
//      chat-completions call with a strict known-vs-unknown prompt.
//   2. Deterministic fallback (always available): schema-shaped brief built
//      from the rule-based extraction. Honest unknowns, never invented.
//
// The brief is an INTERPRETATION aid. iv.projectDescription stays the source
// of truth. Unknowns stay unknown — a probe may ask ABOUT an unknown
// ("How did you handle invalidation?") but never assert it.

const ANALYZER_TIMEOUT_MS = 12000;

export function emptyBrief() {
  return {
    project_summary: '', problem: '', target_users: 'unknown',
    core_functionality: [], architecture: [], technologies: [],
    technical_decisions: [], user_flow: [], candidate_contributions: [],
    technical_claims: [], performance_or_results: [], risks_or_limitations: [],
    unknowns: [], interesting_probe_areas: [],
    source: 'none',
  };
}

// ---- deterministic fallback: schema-shaped, conservative ----
export function deterministicBrief(description, ctx) {
  const b = emptyBrief();
  b.source = 'deterministic';
  const raw = String(description || '').trim();
  if (!raw) return b;
  b.project_summary = raw.length > 220 ? raw.slice(0, 220) + '…' : raw;
  b.problem = ctx?.scope && ctx.scope !== 'this project'
    ? `Build and run ${ctx.scope}`
    : 'unknown';
  b.technologies = [...(ctx?.tech || [])];
  // Architecture: one line per tech — stated role first, plus the
  // vocabulary meaning in parentheses (general knowledge, labeled as such).
  const KIND = {
    react: 'frontend library', vue: 'frontend library', angular: 'frontend framework',
    svelte: 'frontend', next: 'frontend framework', node: 'backend runtime',
    'node.js': 'backend runtime', express: 'backend framework', django: 'backend framework',
    flask: 'backend framework', fastapi: 'backend API framework', spring: 'backend framework',
    postgres: 'relational database', postgresql: 'relational database', mysql: 'relational database',
    sqlite: 'embedded database', mongo: 'document database', mongodb: 'document database',
    redis: 'in-memory cache / store', kafka: 'event streaming', rabbitmq: 'message queue',
    graphql: 'API query language', rest: 'API style', grpc: 'RPC framework', docker: 'containers',
    kubernetes: 'orchestration', aws: 'cloud', gcp: 'cloud', azure: 'cloud', nginx: 'reverse proxy',
    stripe: 'payments', firebase: 'backend platform', supabase: 'backend platform',
  };
  const lower = raw.toLowerCase();
  for (const t of b.technologies) {
    const roleM = raw.match(new RegExp(`([A-Za-z][^.!?]{0,80})\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b([^.!?]{0,80})`, 'i'));
    const stated = roleM ? (roleM[1] + roleM[0].slice(roleM[1].length)).trim().replace(/\s+/g, ' ') : '';
    const kind = KIND[String(t).toLowerCase()] || '';
    b.architecture.push(
      `${t} — ${(stated || 'role unstated').slice(0, 120)}${kind ? ` (${kind}, general knowledge)` : ''}`,
    );
  }
  b.technical_decisions = (ctx?.decisions || []).map((d) => ({
    decision: d.tech ? `Used ${d.tech}` : 'Made a technical choice',
    reason: (/because\s+([^.!?]+)/i.exec(d.sentence)?.[1] || '').trim().slice(0, 140) || 'unknown',
    alternatives: 'unknown',
    tradeoffs: 'unknown',
  }));
  b.candidate_contributions = /\bi\b/i.test(raw) ? ['Candidate describes first-person involvement'] : ['unknown'];
  b.technical_claims = [...(ctx?.claims || [])];
  b.performance_or_results = (ctx?.numbers || 0) > 0 ? ['Candidate states numbers — verify by probing'] : ['unknown'];
  b.risks_or_limitations = ['unknown'];
  // Unknowns: the standard gaps for a project of this shape (topics, not facts).
  const hasCache = /cach|redis|ttl/i.test(raw);
  const hasDb = /postgres|mysql|mongo|sql|database/i.test(raw);
  const hasApi = /api/i.test(raw);
  if (hasCache) b.unknowns.push('cache invalidation strategy', 'cache TTL choice', 'measured cache impact');
  if (hasDb) b.unknowns.push('database indexing', 'query performance', 'transaction handling');
  if (hasApi) b.unknowns.push('API architecture', 'failure handling', 'scaling behavior');
  if (!b.unknowns.length) b.unknowns.push('implementation details', 'tradeoffs', 'measured results');
  b.interesting_probe_areas = [
    ...b.technologies.slice(0, 4).map((t) => `${t} usage and reasoning`),
    ...(hasCache ? ['caching correctness and staleness'] : []),
    ...(hasDb ? ['data modeling and query performance'] : []),
  ].slice(0, 6);
  return b;
}

// ---- LLM path (single call, strict validation, silent fallback) ----
const ANALYZER_SYSTEM = `You are analyzing a student's software project before a technical interview. Understand the project semantically, not merely by extracting keywords. Determine: what problem the project solves; who uses it; what the system actually does; how the major components interact; technologies mentioned; why the candidate says they chose particular technologies; technical decisions explicitly stated; claims made by the candidate; candidate's stated contribution; measurable results; limitations; areas where important information is missing. Do not invent facts. Separate explicit facts from reasonable interpretations. If something is not stated, use the string "unknown" — never guess TTLs, metrics, architectures, or configurations. Use the candidate's own words where possible. Your output will be used by another AI interviewer to ask technically relevant questions. Reply with JSON ONLY, matching this schema: {project_summary, problem, target_users, core_functionality[], architecture[], technologies[], technical_decisions[{decision, reason, alternatives, tradeoffs}], user_flow[], candidate_contributions[], technical_claims[], performance_or_results[], risks_or_limitations[], unknowns[], interesting_probe_areas[]}. Every unknown MUST be the string "unknown" or an array containing only "unknown".`;

function cleanStr(v, cap = 200) {
  if (typeof v !== 'string') return 'unknown';
  const t = v.trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, cap) : 'unknown';
}
function cleanList(v, cap = 8, itemCap = 140) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string' && x.trim()).slice(0, cap).map((x) => x.trim().replace(/\s+/g, ' ').slice(0, itemCap));
}

function validateBrief(o) {
  if (!o || typeof o !== 'object') return null;
  const b = emptyBrief();
  b.source = 'llm';
  b.project_summary = cleanStr(o.project_summary, 300);
  b.problem = cleanStr(o.problem);
  b.target_users = cleanStr(o.target_users);
  b.core_functionality = cleanList(o.core_functionality);
  b.architecture = cleanList(o.architecture);
  b.technologies = cleanList(o.technologies, 12, 40);
  b.user_flow = cleanList(o.user_flow);
  b.candidate_contributions = cleanList(o.candidate_contributions);
  b.technical_claims = cleanList(o.technical_claims);
  b.performance_or_results = cleanList(o.performance_or_results);
  b.risks_or_limitations = cleanList(o.risks_or_limitations);
  b.unknowns = cleanList(o.unknowns, 12);
  b.interesting_probe_areas = cleanList(o.interesting_probe_areas, 8);
  b.technical_decisions = Array.isArray(o.technical_decisions) ? o.technical_decisions.slice(0, 6).map((d) => ({
    decision: cleanStr(d?.decision, 140),
    reason: cleanStr(d?.reason, 140),
    alternatives: cleanStr(d?.alternatives, 140),
    tradeoffs: cleanStr(d?.tradeoffs, 140),
  })) : [];
  return b;
}

async function analyzeWithLLM(description, env = process.env) {
  const base = (env.ANALYZER_BASE_URL || '').trim();
  const key = (env.ANALYZER_API_KEY || '').trim();
  const model = (env.ANALYZER_MODEL || '').trim();
  if (!base || !key || !model) return null; // not configured → fallback
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ANALYZER_TIMEOUT_MS);
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 900,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: ANALYZER_SYSTEM },
          { role: 'user', content: description },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) return null;
    return validateBrief(JSON.parse(text));
  } catch {
    return null; // ANY failure → deterministic fallback, interview still starts
  } finally {
    clearTimeout(timer);
  }
}

// Main entry: ONE analysis per interview. Never throws.
export async function buildProjectBrief(description, ctx, env = process.env) {
  const raw = String(description || '').trim();
  if (!raw) return emptyBrief();
  const llm = await analyzeWithLLM(raw, env);
  if (llm) {
    // Backfill tech from deterministic extraction if the model omitted any.
    for (const t of ctx?.tech || []) {
      if (!llm.technologies.some((x) => x.toLowerCase() === String(t).toLowerCase())) {
        llm.technologies.push(t);
      }
    }
    return llm;
  }
  return deterministicBrief(raw, ctx);
}

// Compact rendering for the voice prompt (bounded — voice latency matters).
export function renderBriefForPrompt(brief) {
  if (!brief || brief.source === 'none') return '';
  const lines = [];
  const push = (k, v) => {
    if (!v) return;
    const s = Array.isArray(v)
      ? v.filter((x) => x && x !== 'unknown').slice(0, 5).join('; ')
      : (v !== 'unknown' ? v : '');
    if (s) lines.push(`${k}: ${s}`.slice(0, 220));
  };
  push('Summary', brief.project_summary);
  push('Problem', brief.problem);
  push('Users', brief.target_users);
  push('Does', (brief.core_functionality || []).join('; '));
  push('Architecture', (brief.architecture || []).join('; '));
  for (const d of (brief.technical_decisions || []).slice(0, 3)) {
    if (d.decision && d.decision !== 'unknown') {
      lines.push(`Decision: ${d.decision}${d.reason && d.reason !== 'unknown' ? ` (reason: ${d.reason})` : ''}`.slice(0, 220));
    }
  }
  push('Claims', (brief.technical_claims || []).join('; '));
  push('Contribution', (brief.candidate_contributions || []).join('; '));
  push('Unknown (ask about, never assert)', (brief.unknowns || []).join('; '));
  push('Probe areas', (brief.interesting_probe_areas || []).join('; '));
  return lines.join('\n').slice(0, 1500);
}
