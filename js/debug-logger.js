// debug-logger.js — Debug logging for ORF assessment
// Saves debug info to downloadable JSON files

function getVersionFromUI() {
  const el = typeof document !== 'undefined' && document.getElementById('version');
  return el ? el.textContent.trim() : 'unknown';
}
let debugLog = null;

/**
 * Initialize a new debug log for an assessment
 */
export function initDebugLog() {
  const version = getVersionFromUI();
  debugLog = {
    version,
    timestamp: new Date().toISOString(),
    codeVersionCheck: {
      expectedVersion: version,
      metricsHasForgiven: typeof window !== 'undefined'
    },
    stages: [],
    warnings: [],
    errors: []
  };
  addStage('init', { message: 'Debug log initialized' });
}

/**
 * Add a stage entry to the debug log
 */
export function addStage(name, data) {
  if (!debugLog) initDebugLog();
  debugLog.stages.push({
    stage: name,
    time: new Date().toISOString(),
    data: JSON.parse(JSON.stringify(data)) // Deep clone
  });
}

/**
 * Add a warning
 */
export function addWarning(message, data = null) {
  if (!debugLog) initDebugLog();
  debugLog.warnings.push({ message, data, time: new Date().toISOString() });
  console.warn('[ORF Debug]', message, data);
}

/**
 * Add an error
 */
export function addError(message, data = null) {
  if (!debugLog) initDebugLog();
  debugLog.errors.push({ message, data, time: new Date().toISOString() });
  console.error('[ORF Debug]', message, data);
}

/**
 * Get the current debug log
 */
export function getDebugLog() {
  return debugLog;
}

/**
 * Save debug log to a downloadable JSON file
 */
export function saveDebugLog(filename = null) {
  if (!debugLog) {
    console.warn('No debug log to save');
    return;
  }

  // Generate timestamp-based filename for easy sorting
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = filename || `orf-debug-${ts}.json`;
  const blob = new Blob([JSON.stringify(debugLog, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();

  URL.revokeObjectURL(url);
  console.log('[ORF Debug] Log saved as', name);
}

/**
 * Auto-save debug log after assessment (call from app.js)
 */
export function finalizeDebugLog(assessmentData) {
  if (!debugLog) return;

  debugLog.finalAssessment = assessmentData;
  debugLog.completedAt = new Date().toISOString();

  // Auto-save
  saveDebugLog();
}
