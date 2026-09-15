// safe.js — VoiceTwin Day 1 (Page 4 stub wired early per the plan's "build this the same day").
// Pressing Esc from any page jumps to /safe.html (Demo Safe Mode).
// The full safe-mode player lands with Page 4; this hotkey is already live so
// the fallback trigger is rehearsed from the very first session.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    window.location.href = '/safe.html';
  }
});
