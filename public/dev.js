// dev.js — strict developer-pages routing.
// console.html and harness.html are dev-only. Normal users never see them:
// this module redirects to / unless dev mode was unlocked via
//   - Ctrl+Shift+D on the landing page, or
//   - opening any page with ?dev=1 (sets the flag for the tab)
// safe.html (demo fallback) and interview/practice pages are NOT guarded.
try {
  if (new URLSearchParams(location.search).get('dev') === '1') {
    sessionStorage.setItem('vt:dev', '1');
    history.replaceState(null, '', location.pathname);
  }
} catch {}
if (sessionStorage.getItem('vt:dev') !== '1') {
  window.location.href = '/';
}
