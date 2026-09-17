// landing.js — Day 6: tiny bit of life on the landing page.
// Demo-recovery hotkey contract: Esc on ANY page jumps to Demo Safe Mode.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !e.repeat) window.location.href = '/safe.html';
});
