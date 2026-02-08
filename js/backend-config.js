/**
 * Backend Configuration — Single source of truth for backend URL and auth.
 *
 * Values read from localStorage once at module load time.
 * Changing the URL or token requires a page reload.
 *
 * This uses top-level const exports (not function-based re-reads like
 * cross-validator.js) because backend URL is infrastructure config that
 * changes rarely and all consuming modules bind it at import time.
 */

function getDefaultBackendUrl() {
  const saved = localStorage.getItem('orf_backend_url');
  if (saved) return saved;
  // If running locally, use localhost
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    return 'http://localhost:8765';
  }
  // If deployed remotely, no default — force user to configure
  return '';
}

export const BACKEND_URL = getDefaultBackendUrl();

export const BACKEND_TOKEN = localStorage.getItem('orf_backend_token') || '';

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
