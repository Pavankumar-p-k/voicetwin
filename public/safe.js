// safe.js — Demo Safe Mode fallback hotkey.
// Ctrl+Esc from any page jumps to /safe.html (Demo Safe Mode).
// Plain Esc is reserved for the browser/inputs — Ctrl is required so the
// fallback never fires by accident mid-interview.
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && (e.key === 'Escape' || e.key === 'Esc')) {
    e.preventDefault();
    window.location.href = '/safe.html';
  }
});
