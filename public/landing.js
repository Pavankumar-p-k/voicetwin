// landing.js — Screen 1: project input. No auth.
// Collects the project description, stores it for the interview screen,
// and hands off. The text travels via sessionStorage.
const input = document.getElementById('projectInput');
const btn = document.getElementById('startInterviewBtn');
const err = document.getElementById('projectErr');
const cards = document.getElementById('diffCards');
const saveBtn = document.getElementById('saveDraftBtn');
const draftStatus = document.getElementById('draftStatus');
const charCount = document.getElementById('charCount');

const DRAFT_KEY = 'vt:interviewDraft';
const MIN_LEN = 20;
const MAX_LEN = 4000; // must match server validation in server/index.js

function paintCount() {
  if (!charCount) return;
  const n = (input?.value || '').length;
  charCount.textContent = `${n} / ${MAX_LEN}`;
  charCount.style.color = n > MAX_LEN ? '#e02323' : '';
}
input?.addEventListener('input', paintCount);

// Draft = USER SETUP ONLY (project + difficulty). No audio, no transcripts.
// Oversized/poisoned drafts (e.g. a pasted README) are dropped, never restored.
function readDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (typeof d.project !== 'string' || typeof d.difficulty !== 'string') return null;
    if (d.project.length < MIN_LEN || d.project.length > MAX_LEN) {
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      return null;
    }
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
  // Overlong values (e.g. a pasted README) are trimmed to the limit, not dropped.
  if (saved && input && saved.length >= MIN_LEN) {
    input.value = saved.length > MAX_LEN ? saved.slice(0, MAX_LEN) : saved;
    if (saved.length > MAX_LEN) {
      try { sessionStorage.setItem('vt:project', input.value); } catch {}
      showDraftStatus(`Trimmed ${saved.length} → ${MAX_LEN} chars (limit)`);
    }
  }
  else if (saved) { try { sessionStorage.removeItem('vt:project'); } catch {} }
} catch {}
paintCount();

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

function fail(msg) {
  if (err) { err.textContent = msg; err.style.display = 'block'; }
  input?.focus();
}

function start() {
  const text = (input?.value || '').trim();
  if (text.length < MIN_LEN) {
    fail(`Write a few sentences about your project first — ${text.length}/${MIN_LEN} chars minimum.`);
    return;
  }
  if (text.length > MAX_LEN) {
    fail(`Too long (${text.length}/${MAX_LEN} chars) — shorten to one project, your role, and one hard decision.`);
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

// Dev unlock: Ctrl+Shift+D enables console/harness for this tab.
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
    e.preventDefault();
    try { sessionStorage.setItem('vt:dev', '1'); } catch {}
    showDraftStatus('Dev mode on — console + harness unlocked in this tab');
  }
});
