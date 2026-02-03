/**
 * Ghost word detection for VAD-based hallucination flagging.
 * Flags `latest_only` words that appear in reference text but have no VAD speech overlap.
 */

// Constants
export const EDGE_TOLERANCE_MS = 300;     // First/last 300ms of recording - be lenient
const OVERLAP_DEFAULT_MS = 50;            // Normal words need 50ms VAD overlap
const OVERLAP_SHORT_WORD_MS = 30;         // Short words (<200ms) need only 30ms
const SHORT_WORD_DURATION_MS = 200;       // Threshold for "short word"
const GHOST_SEQUENCE_THRESHOLD = 5;       // 5+ consecutive = escalated flagging

/**
 * Parse Google STT timestamp to milliseconds.
 * @param {string|number} t - Timestamp like "1.400s" or number (seconds)
 * @returns {number} Milliseconds
 */
function parseTimeMs(t) {
  if (typeof t === 'number') return t * 1000;
  return (parseFloat(String(t).replace('s', '')) || 0) * 1000;
}

/**
 * Check if word is at audio edge (first/last EDGE_TOLERANCE_MS).
 * @param {number} wordStartMs - Word start time in milliseconds
 * @param {number} wordEndMs - Word end time in milliseconds
 * @param {number} audioDurationMs - Total audio duration in milliseconds
 * @returns {boolean} True if word is at audio edge
 */
function isAtAudioEdge(wordStartMs, wordEndMs, audioDurationMs) {
  // Near start of recording
  if (wordStartMs < EDGE_TOLERANCE_MS) return true;
  // Near end of recording
  if (wordEndMs > audioDurationMs - EDGE_TOLERANCE_MS) return true;
  return false;
}

/**
 * Compute maximum overlap between a word's time range and VAD speech segments.
 * @param {number} wordStartMs - Word start time in milliseconds
 * @param {number} wordEndMs - Word end time in milliseconds
 * @param {Array<{start: number, end: number}>} vadSegments - VAD speech segments
 * @returns {number} Maximum overlap in milliseconds (0 if no overlap)
 */
function computeMaxOverlap(wordStartMs, wordEndMs, vadSegments) {
  let maxOverlap = 0;

  for (const seg of vadSegments) {
    const overlapStart = Math.max(wordStartMs, seg.start);
    const overlapEnd = Math.min(wordEndMs, seg.end);

    if (overlapStart < overlapEnd) {
      const overlap = overlapEnd - overlapStart;
      maxOverlap = Math.max(maxOverlap, overlap);
    }
  }

  return maxOverlap;
}

/**
 * Normalize word for reference matching.
 * @param {string} word - Word to normalize
 * @returns {string} Lowercase word with leading/trailing punctuation removed
 */
function normalizeWord(word) {
  // Convert to lowercase
  let normalized = word.toLowerCase();
  // Remove leading/trailing non-alphanumeric except apostrophe and hyphen
  normalized = normalized.replace(/^[^a-z0-9'-]+|[^a-z0-9'-]+$/g, '');
  return normalized;
}

/**
 * Flag ghost words - latest_only words with no VAD speech overlap.
 * @param {Array} mergedWords - Words from ensemble-merger with source tags
 * @param {object} vadResult - Result from vadProcessor.processAudio()
 * @param {string} referenceText - Reference passage text (empty = skip detection)
 * @param {number} audioDurationMs - Total audio duration in milliseconds
 * @returns {object} { ghostCount, hasGhostSequence, vadError, ghostIndices }
 */
export function flagGhostWords(mergedWords, vadResult, referenceText, audioDurationMs) {
  // VAD failure handling - warn and continue without ghost detection
  if (!vadResult || !vadResult.segments || vadResult.error) {
    return {
      ghostCount: 0,
      hasGhostSequence: false,
      vadError: vadResult?.error || 'No VAD segments',
      ghostIndices: []
    };
  }

  // No reference text - disable ghost detection entirely per CONTEXT.md
  if (!referenceText || !referenceText.trim()) {
    return {
      ghostCount: 0,
      hasGhostSequence: false,
      vadError: null,
      ghostIndices: []
    };
  }

  // Build reference word set for O(1) lookup
  const referenceWords = referenceText.split(/\s+/).filter(Boolean);
  const referenceSet = new Set(referenceWords.map(w => normalizeWord(w)));

  // Ghost tracking
  let ghostCount = 0;
  let consecutiveGhosts = 0;
  let maxConsecutive = 0;
  const ghostIndices = [];

  // Iterate through merged words
  for (let i = 0; i < mergedWords.length; i++) {
    const word = mergedWords[i];

    // Reset ghost flag for this word
    word.vad_ghost_in_reference = false;

    // Skip if not latest_only - only these are potential ghosts
    if (word.source !== 'latest_only') {
      consecutiveGhosts = 0;
      continue;
    }

    // Skip if NOT in reference (per CONTEXT.md: only flag words that ARE in reference)
    const wordNorm = normalizeWord(word.word);
    if (!referenceSet.has(wordNorm)) {
      consecutiveGhosts = 0;
      continue;
    }

    // Parse word timestamps
    const wordStart = parseTimeMs(word.startTime);
    const wordEnd = parseTimeMs(word.endTime);

    // Skip edge words (first/last 300ms) - per CONTEXT.md: be lenient at audio edges
    if (isAtAudioEdge(wordStart, wordEnd, audioDurationMs)) {
      consecutiveGhosts = 0;
      continue;
    }

    // Check VAD overlap
    const wordDuration = wordEnd - wordStart;
    const maxOverlap = computeMaxOverlap(wordStart, wordEnd, vadResult.segments);

    // Determine required overlap (more lenient for short words)
    const requiredOverlap = wordDuration < SHORT_WORD_DURATION_MS
      ? OVERLAP_SHORT_WORD_MS
      : OVERLAP_DEFAULT_MS;

    // Trust if VAD sees anything (per CONTEXT.md: trust if VAD sees anything)
    if (maxOverlap >= requiredOverlap) {
      consecutiveGhosts = 0;
      continue; // VAD detected speech - not a ghost
    }

    // Flag as ghost
    word.vad_ghost_in_reference = true;
    ghostCount++;
    ghostIndices.push(i);
    consecutiveGhosts++;
    maxConsecutive = Math.max(maxConsecutive, consecutiveGhosts);
  }

  // Return results (per CONTEXT.md: escalate 5+ consecutive ghosts)
  return {
    ghostCount,
    hasGhostSequence: maxConsecutive >= GHOST_SEQUENCE_THRESHOLD,
    vadError: null,
    ghostIndices
  };
}
