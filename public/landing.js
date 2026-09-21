// landing.js — Screen 1: auth + project input + difficulty + history.
import { getUser, api, loginWithGoogle, signUp, signIn, logout } from './auth.js';

const authGate = document.getElementById('authGate');
const appView = document.getElementById('appView');
const signedIn = document.getElementById('signedIn');
const authEmail = document.getElementById('authEmail');
const authMsg = document.getElementById('authMsg');
const historyBlock = document.getElementById('historyBlock');
const historyList = document.getElementById('historyList');

function paintAuth() {
  const u = getUser();
  // Gate: logged out sees ONLY login/create account. No app behind it.
  if (authGate) authGate.hidden = !!u;
  if (appView) appView.hidden = !u;
  if (u && authEmail) authEmail.textContent = u.email || 'Signed in';
  if (u) loadHistory();
  else if (historyBlock) historyBlock.hidden = true;
}

let authTab = 'signup';
function authNote(text, tone) {
  if (!authMsg) return;
  authMsg.textContent = text;
  if (tone) authMsg.dataset.tone = tone;
  else delete authMsg.dataset.tone;
}
function paintTab() {
  document.querySelectorAll('#authTabs .auth-tab').forEach((t) => {
    t.classList.toggle('selected', t.dataset.tab === authTab);
  });
  const submit = document.getElementById('authSubmit');
  if (submit) submit.textContent = authTab === 'signup' ? 'Create account →' : 'Log in →';
}
document.getElementById('authTabs')?.addEventListener('click', (e) => {
  const tab = e.target.closest('.auth-tab');
  if (!tab) return;
  authTab = tab.dataset.tab;
  paintTab();
  if (authMsg) authMsg.textContent = '';
});
paintTab();

document.getElementById('googleBtn')?.addEventListener('click', () => {
  loginWithGoogle().catch((e) => { authNote(e.message, 'error'); });
});
document.getElementById('authForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('authEmailInput')?.value.trim();
  const password = document.getElementById('authPassword')?.value || '';
  if (!email || password.length < 6) {
    authNote('Enter your email and a 6+ character password.', 'error');
    return;
  }
  const submit = document.getElementById('authSubmit');
  if (submit) { submit.disabled = true; submit.textContent = 'Please wait…'; }
  try {
    if (authTab === 'signup') await signUp(email, password);
    else await signIn(email, password);
    paintAuth();
  } catch (err) { authNote(err.message, 'error'); }
  finally { paintTab(); if (submit) submit.disabled = false; }
});
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await logout();
  paintAuth();
});

function timeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function loadHistory() {
  if (!historyList || !historyBlock) return;
  try {
    const r = await api('/api/me/interviews');
    if (!r.ok) return;
    const { interviews = [] } = await r.json();
    if (!interviews.length) { historyBlock.hidden = true; return; }
    historyBlock.hidden = false;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    historyList.innerHTML = interviews.map((iv) => {
      const proj = String(iv.project_description || 'Untitled project');
      const short = proj.length > 60 ? proj.slice(0, 60) + '…' : proj;
      const score = iv.score == null ? '—' : `${(iv.score / 10).toFixed(1)} / 10`;
      return `<div class="recent-row"><span class="role">${esc(short)}</span>` +
        `<span class="score">${esc(iv.difficulty || '')} · ${score}</span>` +
        `<span class="when">${timeAgo(iv.completed_at || iv.created_at)}</span></div>`;
    }).join('');
  } catch { /* history is best-effort; interview flow matters more */ }
}

paintAuth();
// landing.js — Screen 1: project input.
// Collects the project description, stores it for the interview screen,
// and hands off. No backend change: the text travels via sessionStorage
// and is shown as interview context until project-aware prompting lands.
const input = document.getElementById('projectInput');
const btn = document.getElementById('startInterviewBtn');
const err = document.getElementById('projectErr');
const cards = document.getElementById('diffCards');
const saveBtn = document.getElementById('saveDraftBtn');
const draftStatus = document.getElementById('draftStatus');

const DRAFT_KEY = 'vt:interviewDraft';

// Draft = USER SETUP ONLY (project + difficulty). No audio, no transcripts.
function readDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (typeof d.project !== 'string' || typeof d.difficulty !== 'string') return null;
    return d;
  } catch { return null; }
}

function showDraftStatus(text) {
  if (draftStatus) {
    draftStatus.textContent = text;
    draftStatus.style.display = text ? 'block' : 'none';
  }
}

try {
  const saved = sessionStorage.getItem('vt:project') || '';
  if (saved && input) input.value = saved;
} catch {}

let mode = 'medium';
try { mode = sessionStorage.getItem('vt:mode') || 'medium'; } catch {}
// Returning visitor with no live tab state: restore the saved draft.
if (!sessionStorage.getItem('vt:project')) {
  const d = readDraft();
  if (d) {
    if (input && d.project) input.value = d.project;
    if (['simple', 'medium', 'hard'].includes(d.difficulty)) mode = d.difficulty;
    showDraftStatus('Saved locally');
  }
} else {
  if (readDraft()) showDraftStatus('Saved locally');
}
function paintMode() {
  cards?.querySelectorAll('.diff-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.mode === mode);
  });
}
paintMode();
cards?.addEventListener('click', (e) => {
  const card = e.target.closest('.diff-card');
  if (!card) return;
  mode = card.dataset.mode;
  try { sessionStorage.setItem('vt:mode', mode); } catch {}
  paintMode();
});

function start() {
  if (!getUser()) {
    paintAuth(); // gate is showing; nothing else to do
    return;
  }
  const text = (input?.value || '').trim();
  if (text.length < 20) {
    if (err) err.style.display = 'block';
    input?.focus();
    return;
  }
  try {
    sessionStorage.setItem('vt:project', text);
    sessionStorage.setItem('vt:mode', mode);
  } catch {}
  window.location.href = '/interview.html';
}

btn?.addEventListener('click', start);
saveBtn?.addEventListener('click', () => {
  const draft = {
    project: (input?.value || '').trim(),
    difficulty: mode,
    updatedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    showDraftStatus('Saved locally');
  } catch {}
});
input?.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') start();
});
input?.addEventListener('input', () => { if (err) err.style.display = 'none'; });
