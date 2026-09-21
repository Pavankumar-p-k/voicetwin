// db.js — Postgres persistence via Supabase PostgREST (no new npm deps).
// All calls carry the USER's access token, so RLS (auth.uid() = user_id)
// enforces ownership as a second layer behind our own WHERE user_id checks.
// No service-role key, no DATABASE_URL, no connection pool to manage.
function cfg() {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY || '';
  if (!base || !anon) {
    const err = new Error('database not configured');
    err.status = 503;
    throw err;
  }
  return { base, anon };
}

async function rest(path, token, { method = 'GET', body = null, query = '' } = {}) {
  const { base, anon } = cfg();
  const res = await fetch(`${base}/rest/v1/${path}${query}`, {
    method,
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : undefined,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 || res.status === 403) {
    const err = new Error('not authorized');
    err.status = res.status === 401 ? 401 : 403;
    throw err;
  }
  if (res.status === 409) {
    const err = new Error('already exists');
    err.status = 409;
    throw err;
  }
  if (!res.ok) {
    const err = new Error('database request failed');
    err.status = 502;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function saveInterview(token, row) {
  const rows = await rest('interviews', token, { method: 'POST', body: row });
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function saveAnswers(token, rows) {
  if (!rows.length) return [];
  return rest('interview_answers', token, { method: 'POST', body: rows });
}

export async function completeInterview(token, id, patch) {
  const rows = await rest('interviews', token, {
    method: 'PATCH',
    query: `?id=eq.${encodeURIComponent(id)}`,
    body: patch,
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function listInterviews(token, userId) {
  return rest('interviews', token, {
    query: `?user_id=eq.${encodeURIComponent(userId)}&select=id,project_description,difficulty,score,questions_asked,created_at,completed_at&order=created_at.desc&limit=50`,
  }) || [];
}

export async function getInterview(token, userId, id) {
  const rows = await rest('interviews', token, {
    query: `?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&select=*`,
  }) || [];
  if (!rows.length) {
    const err = new Error('not found');
    err.status = 404; // same response whether missing or another user's
    throw err;
  }
  const answers = await rest('interview_answers', token, {
    query: `?interview_id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&select=question,answer,specificity,evidence_earned,evidence_total,created_at&order=created_at.asc`,
  }) || [];
  return { ...rows[0], answers };
}

export function mapReportToRow(userId, interviewId, { projectDescription, difficulty, report }) {
  return {
    id: interviewId,
    user_id: userId,
    project_description: String(projectDescription || '').slice(0, 4000),
    difficulty: ['simple', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium',
    score: typeof report?.evidenceScore === 'number' ? report.evidenceScore : null,
    total_earned: report?.totalEarned ?? null,
    total_possible: report?.totalPossible ?? null,
    questions_asked: report?.questionsAsked ?? 0,
    report,
    completed_at: new Date().toISOString(),
  };
}
