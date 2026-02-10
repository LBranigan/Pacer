/**
 * Backend Configuration — Single source of truth for backend URL and auth.
 *
 * Priority order:
 * 1. localStorage (set by user or URL params)
 * 2. backend-config.json (auto-updated by start_services.bat)
 * 3. localhost fallback (for local development)
 *
 * Changing the URL or token requires a page reload.
 */

function getDefaultBackendUrl() {
  const saved = localStorage.getItem('orf_backend_url');
  if (saved) return saved;
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    return 'http://localhost:8765';
  }
  return '';
}

function getDefaultBackendToken() {
  return localStorage.getItem('orf_backend_token') || '';
}

export let BACKEND_URL = getDefaultBackendUrl();
export let BACKEND_TOKEN = getDefaultBackendToken();

/**
 * Fetch backend config from backend-config.json if no settings exist.
 * Returns a promise that resolves when config is ready.
 */
export const backendReady = (['localhost', '127.0.0.1'].includes(location.hostname))
  ? Promise.resolve()
  : fetch('backend-config.json?t=' + Date.now())
      .then(r => r.json())
      .then(cfg => {
        if (cfg.backendUrl) {
          BACKEND_URL = cfg.backendUrl;
          localStorage.setItem('orf_backend_url', cfg.backendUrl);
        }
        if (cfg.backendToken) {
          BACKEND_TOKEN = cfg.backendToken;
          localStorage.setItem('orf_backend_token', cfg.backendToken);
        }
      })
      .catch(() => {}); // Silent fail — user can configure manually

/**
 * Build fetch headers with optional auth token.
 * @param {string} [contentType] - Content-Type header value (omit for GET requests)
 * @returns {object} Headers object ready for fetch()
 */
export function backendHeaders(contentType) {
  const h = {};
  if (contentType) h['Content-Type'] = contentType;
  if (BACKEND_TOKEN) h['Authorization'] = `Bearer ${BACKEND_TOKEN}`;
  return h;
}
