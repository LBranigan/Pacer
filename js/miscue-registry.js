/**
 * MISCUE TYPE REGISTRY
 * =====================
 *
 * SINGLE SOURCE OF TRUTH for all reading miscue/error types.
 *
 * IMPORTANT: When adding a new miscue type, you MUST add it here.
 * If it's not in this file, it doesn't exist in the system.
 *
 * Each entry documents:
 * - description: What this miscue type means
 * - detector: File and function where detection occurs
 * - countsAsError: Whether it affects accuracy calculation
 * - config: Relevant threshold settings (if any)
 * - example: Concrete example of this miscue
 * - uiClass: CSS class used for display (if any)
 */

// ============================================================================
// ALIGNMENT-BASED MISCUES (detected via diff-match-patch in alignment.js)
// These compare the reference text against what the student said
// ============================================================================

const ALIGNMENT_MISCUES = {
  omission: {
    description: 'Student skipped a word from the reference text',
    detector: 'alignment.js → alignWords()',
    countsAsError: true,
    config: null,
    example: {
      reference: 'the big dog',
      spoken: 'the dog',
      result: '"big" is an omission'
    },
    uiClass: 'word-omission'
  },

  substitution: {
    description: 'Student said a different word than the reference',
    detector: 'alignment.js → alignWords()',
    countsAsError: true,
    config: null,
    example: {
      reference: 'house',
      spoken: 'horse',
      result: '"horse" substituted for "house"'
    },
    uiClass: 'word-substitution'
  },

  insertion: {
    description: 'Student added a word not in the reference text',
    detector: 'alignment.js → alignWords()',
    countsAsError: false, // Per ORF standards, insertions don't count against accuracy
    config: null,
    example: {
      reference: 'the dog',
      spoken: 'the big dog',
      result: '"big" is an insertion'
    },
    uiClass: 'word-insertion'
  }
};

// ============================================================================
// DISFLUENCY MISCUES (detected in disfluency-detector.js)
// These detect stutters, false starts, and repetitions
// ============================================================================

const DISFLUENCY_MISCUES = {
  fragment: {
    description: 'Incomplete word attempt (false start) before the full word',
    detector: 'disfluency-detector.js → checkForFragment()',
    countsAsError: false, // Merged into target word, doesn't affect accuracy
    config: {
      FRAGMENT_MAX_LOOKAHEAD: 1,        // Only check next word (i+1)
      FRAGMENT_MAX_TIME_GAP_SEC: 0.5,   // Must resolve within 500ms
      SHORT_FRAGMENT_MAX_CHARS: 3,      // Short fragments use prefix matching
      LONG_PREFIX_MIN_CHARS: 4          // Long fragments need exact/long prefix
    },
    example: {
      reference: 'please',
      spoken: 'p- p- please',
      result: '"p" and "p" are fragments merged into "please"'
    },
    uiClass: null, // Fragments are merged, not displayed separately
    filters: [
      'Filter 1: Reference Text Protection (phonetic N-gram matching)',
      'Filter 2: Phonological Horizons (i+1 only, 500ms)',
      'Filter 3: Confidence Protection (>= 0.93 blocks merge)'
    ]
  },

  repetition: {
    description: 'Same word repeated consecutively (self-correction attempt)',
    detector: 'disfluency-detector.js → checkForRepetition()',
    countsAsError: false, // Shows struggle but not counted as error
    config: {
      REPETITION_MAX_LOOKAHEAD: 2,      // Check i+1 and i+2
      REPETITION_MAX_TIME_GAP_SEC: 1.0  // Can have fillers between (loose)
    },
    example: {
      reference: 'the dog',
      spoken: 'the the the dog',
      result: 'Two repetitions of "the" detected'
    },
    uiClass: 'word-self-correction'
  }
};

// ============================================================================
// REVERB DISFLUENCY MISCUES (detected in disfluency-tagger.js via Kitchen Sink pipeline)
// Model-level disfluencies from Reverb verbatim vs clean diff (Phase 23/24)
// ============================================================================

const REVERB_DISFLUENCY_MISCUES = {
  reverb_filler: {
    description: 'Filler word detected by Reverb verbatim/clean diff (um, uh, er, ah, mm, hmm)',
    detector: 'disfluency-tagger.js -> tagDisfluencies() via kitchen-sink-merger.js',
    countsAsError: false,
    config: null,
    example: {
      reference: 'the cat sat',
      spoken: 'the um cat sat',
      result: '"um" detected as filler via Reverb v=1.0 vs v=0.0 alignment'
    },
    uiClass: 'word-disfluency',
    note: 'Model-level detection: Reverb includes fillers in verbatim (v=1.0) but removes them in clean (v=0.0). Needleman-Wunsch alignment identifies the insertion.'
  },

  reverb_repetition: {
    description: 'Word repetition detected by Reverb verbatim/clean diff',
    detector: 'disfluency-tagger.js -> tagDisfluencies() via kitchen-sink-merger.js',
    countsAsError: false,
    config: null,
    example: {
      reference: 'the cat sat',
      spoken: 'the the cat sat',
      result: '"the" (first) detected as repetition via Reverb v=1.0 vs v=0.0 alignment'
    },
    uiClass: 'word-disfluency',
    note: 'Model-level detection: Reverb preserves repetitions in verbatim but normalizes them in clean output.'
  },

  reverb_false_start: {
    description: 'False start (partial word) detected by Reverb verbatim/clean diff',
    detector: 'disfluency-tagger.js -> tagDisfluencies() via kitchen-sink-merger.js',
    countsAsError: false,
    config: null,
    example: {
      reference: 'the cat sat',
      spoken: 'the ca- cat sat',
      result: '"ca-" detected as false start via Reverb v=1.0 vs v=0.0 alignment'
    },
    uiClass: 'word-disfluency',
    note: 'Model-level detection: Reverb captures partial word attempts in verbatim that are absent from clean output.'
  }
};

// ============================================================================
// DIAGNOSTIC MISCUES (detected in diagnostics.js)
// These measure fluency indicators beyond word accuracy
// ============================================================================

const DIAGNOSTIC_MISCUES = {
  hesitation: {
    description: 'Noticeable pause before a word (indicates decoding difficulty)',
    detector: 'diagnostics.js → detectOnsetDelays()',
    countsAsError: false, // Diagnostic only, not an error
    config: {
      default_threshold_ms: 500,
      after_period_threshold_ms: 1200,  // More time allowed after sentence end
      after_comma_threshold_ms: 800,    // More time allowed after comma
      max_before_long_pause_ms: 3000    // Above 3s becomes "long pause"
    },
    vadOverhangCorrection: {
      description: 'vad-gap-analyzer.js → adjustGapsWithVADOverhang(): corrects gap values where STT under-timed word endpoints',
      criterion: 'VAD speech segment must overlap with previous word AND extend past its STT end time',
      effect: 'Gap recalculated using VAD segment end as "real" word end; hesitations below threshold after correction are removed',
      safety: 'Segment must originate during the word (not start fresh in the gap) — rules out false starts, fillers, background noise'
    },
    example: {
      context: 'Word ends at 2.0s, next word starts at 2.8s',
      result: '800ms gap flagged as hesitation (default threshold 500ms)'
    },
    uiClass: 'word-hesitation'
  },

  longPause: {
    description: 'Extended silence (3+ seconds) indicating student got stuck',
    detector: 'diagnostics.js → detectLongPauses()',
    countsAsError: true, // Long pauses are considered errors
    config: {
      LONG_PAUSE_THRESHOLD_SEC: 3.0
    },
    example: {
      context: '"the" ends at 1.0s, "dog" starts at 5.5s',
      result: '4.5s gap flagged as long pause (error)'
    },
    uiClass: 'pause-indicator'
  },

  selfCorrection: {
    description: 'Student repeated a word/phrase or made a near-miss attempt before producing the word correctly',
    detector: 'diagnostics.js → detectSelfCorrections() (DIAG-03: word/phrase repeats) + resolveNearMissClusters() (near-miss insertion before correct word)',
    countsAsError: false, // Shows effort to correct, not penalized
    config: null,
    example: {
      spoken: '"epi-" then "epiphany" — near-miss insertion before correct word',
      result: 'Insertion "epi-" flagged as self-correction (near-miss for following correct "epiphany")'
    },
    uiClass: 'word-self-correction',
    note: 'Two detection paths: DIAG-03 detects word/phrase repeats in transcript; resolveNearMissClusters detects near-miss insertions (shared prefix/suffix/Levenshtein) before a correct word.'
  },

  morphological: {
    description: 'Wrong ending or wrong beginning - same root but different affix',
    detector: 'diagnostics.js → detectMorphologicalErrors()',
    countsAsError: true, // Counted as substitution
    config: {
      min_shared_affix: 3,               // Must share 3+ char prefix OR suffix
      // No cross-validation gate: morphological is about the error pattern,
      // not ASR reliability. A confirmed "runned" for "running" is still morphological.
      // Uses positional lookup (transcriptWords[hypIndex]) for metadata.
    },
    example: {
      reference: 'running / unhappy',
      spoken: 'runned / happy',
      result: 'Shared prefix "run" (suffix error) or shared suffix "happy" (prefix error)'
    },
    uiClass: 'word-morphological'
  },

  struggle: {
    description: 'Substitution+ — student failed to produce the word, with additional evidence of decoding difficulty (long pause, near-miss fragments, and/or abandoned attempt). Always an error.',
    detector: 'diagnostics.js → resolveNearMissClusters() (Path 2: decoding) + detectStruggleWords() (Path 1: hesitation, Path 3: abandoned attempt)',
    countsAsError: true, // Struggle = substitution+ = always an error
    config: {
      // Path 1: substitution + pause >= 3s + ref word > 3 chars
      pause_threshold_s: 3,
      // Path 2: substitution + near-miss insertions + ref word >= 3 chars
      near_miss_min_shared_affix: 3,     // Shared prefix or suffix >= 3 chars
      near_miss_levenshtein_threshold: 0.4, // Or Levenshtein ratio >= 0.4
      min_word_length: 4,                // Reference word > 3 chars (4+)
      // Path 3: substitution + crossValidation 'unconfirmed' (Deepgram N/A) + near-miss
      // No min_word_length gate — near-miss check provides sufficient signal
    },
    example: {
      context: 'Path 2: Student says "sta", "tieion", "staion" for "station". Path 3: Student says "cont" for "content\'s" — only verbatim STT detected it, Deepgram heard nothing.',
      result: 'Substitution upgraded to struggle via matching pathway(s)'
    },
    uiClass: 'word-struggle',
    pathways: {
      hesitation: 'Path 1: substitution + 3s+ pause before the word → student hesitated then failed',
      decoding: 'Path 2: substitution + near-miss insertions around it → multiple failed decoding attempts',
      abandoned: 'Path 3: substitution + Deepgram N/A + near-miss match → partial/garbled attempt only verbatim STT detected'
    },
    note: 'The struggle alignment type is always "substitution+". It only exists when the student failed to produce the word. A word can match multiple pathways simultaneously. Correct words with hesitation do not become struggle — they remain correct with onset delay information (DIAG-05).'
  }
};

// ============================================================================
// CONFIDENCE-BASED MISCUES (detected in ghost-detector.js, confidence-classifier.js)
// These identify potential STT hallucinations or uncertain transcriptions
// ============================================================================

const CONFIDENCE_MISCUES = {
  ghost: {
    description: 'Word detected by STT but VAD found no speech at that time',
    detector: 'ghost-detector.js → flagGhostWords()',
    countsAsError: false, // Filtered out before alignment
    config: {
      min_vad_overlap_ms: 50,            // Requires 50ms speech overlap
      short_word_overlap_ms: 30,         // Short words need only 30ms
      edge_leniency_ms: 300              // Lenient at audio start/end
    },
    example: {
      context: 'STT reports "the" at 5.0s-5.2s, but VAD shows silence',
      result: 'Word flagged as ghost, confidence set to 0.0'
    },
    uiClass: null, // Ghosts are filtered, not displayed
    note: 'Only flags latest_only words that ARE in reference text'
  },

  possibleInsertion: {
    description: 'Word only in latest_long model and NOT in reference text',
    detector: 'confidence-classifier.js → classifyWordConfidence()',
    countsAsError: false, // Flagged for review, not auto-penalized
    config: {
      assigned_confidence: 0.50          // Below MEDIUM threshold
    },
    example: {
      context: 'latest_long says "um" but default model and reference have nothing',
      result: 'Flagged as possible_insertion with 0.50 confidence'
    },
    uiClass: null,
    flag: 'possible_insertion'
  },

  referenceVeto: {
    description: 'When STT models disagree on word, prefer the one matching reference text',
    detector: 'ensemble-merger.js → createMergedWord()',
    countsAsError: false, // Arbitration rule, not an error
    config: {
      // Applied when: latestWord.word !== defaultWord.word
      // Logic: If default matches reference AND latest doesn't → use default
      //        If neither matches → use latest_long (legitimate substitution)
    },
    example: {
      context: 'latest_long heard "Hefty", default heard "happy", reference says "happy"',
      result: 'Reference Veto applied: "happy" used instead of "Hefty"'
    },
    uiClass: null,
    debugField: '_debug.referenceVetoApplied',
    note: 'Handles cases where latest_long\'s better vocabulary makes wrong guesses. Does NOT veto when student makes legitimate substitution (neither matches reference).'
  }
};

// ============================================================================
// FORGIVENESS RULES (detected in metrics.js / alignment post-processing)
// These identify errors that should NOT count against the student
// ============================================================================

const FORGIVENESS_RULES = {
  properNounForgiveness: {
    description: 'Phonetically close attempt at a proper noun (name)',
    detector: 'metrics.js → computeAccuracy() / NL API proper noun detection',
    countsAsError: false, // Forgiven - student decoded correctly, just unfamiliar
    config: {
      min_similarity: 0.40               // 40% Levenshtein similarity required
    },
    example: {
      reference: 'Hermione',
      spoken: 'Her-my-oh-nee',
      result: 'Proper noun + phonetically close = forgiven'
    },
    uiClass: 'word-forgiven',
    note: 'Student used phonics correctly but doesn\'t know the name'
  },

  terminalLeniency: {
    description: 'Errors in last 1-2 words when recording was cut off',
    detector: 'app.js → terminal leniency check',
    countsAsError: false, // Recording ended, not student\'s fault
    config: {
      max_words_from_end: 2
    },
    example: {
      context: 'Student reading "sandwich" when recording stopped',
      result: 'Final word error forgiven due to cutoff'
    },
    uiClass: null
  }
};

// ============================================================================
// SEVERITY LEVELS (used by disfluency-detector.js)
// ============================================================================

export const SEVERITY_LEVELS = {
  none: {
    description: 'Clean read - single attempt, no struggle',
    criteria: '1 attempt'
  },
  minor: {
    description: 'Slight hesitation - brief retry',
    criteria: '2 attempts'
  },
  moderate: {
    description: 'Noticeable struggle - multiple retries or long pause',
    criteria: '3-4 attempts OR maxPause >= 0.5s with 2+ attempts'
  },
  significant: {
    description: 'Major difficulty - many retries or extended struggle',
    criteria: '5+ attempts OR totalDuration >= 2.0s'
  }
};

// ============================================================================
// COMBINED REGISTRY EXPORT
// ============================================================================

export const MISCUE_REGISTRY = {
  // Alignment-based (core errors)
  ...ALIGNMENT_MISCUES,

  // Disfluencies (stutters, repetitions)
  ...DISFLUENCY_MISCUES,

  // Reverb disfluencies (model-level detection via verbatim/clean diff)
  ...REVERB_DISFLUENCY_MISCUES,

  // Diagnostics (fluency indicators)
  ...DIAGNOSTIC_MISCUES,

  // Confidence-based (STT quality)
  ...CONFIDENCE_MISCUES,

  // Forgiveness rules
  ...FORGIVENESS_RULES
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get all miscue types that count against accuracy.
 * @returns {string[]} Array of miscue type names
 */
export function getErrorTypes() {
  return Object.entries(MISCUE_REGISTRY)
    .filter(([_, v]) => v.countsAsError)
    .map(([k, _]) => k);
}

/**
 * Get all miscue types that are diagnostic only (don't affect score).
 * @returns {string[]} Array of miscue type names
 */
export function getDiagnosticTypes() {
  return Object.entries(MISCUE_REGISTRY)
    .filter(([_, v]) => !v.countsAsError)
    .map(([k, _]) => k);
}

/**
 * Get miscue info by type name.
 * @param {string} type - Miscue type name
 * @returns {object|null} Miscue info or null if not found
 */
export function getMiscueInfo(type) {
  return MISCUE_REGISTRY[type] || null;
}

/**
 * Get detector location for a miscue type.
 * @param {string} type - Miscue type name
 * @returns {string|null} Detector file and function
 */
export function getDetectorLocation(type) {
  const info = MISCUE_REGISTRY[type];
  return info ? info.detector : null;
}

// ============================================================================
// SUMMARY (for quick reference)
// ============================================================================

/**
 * QUICK REFERENCE - What counts as an error?
 *
 * ERRORS (affect accuracy):
 * - omission: Skipped a word
 * - substitution: Wrong word
 * - struggle: Substitution+ with decoding difficulty evidence (hesitation / near-miss fragments / abandoned attempt)
 * - longPause: Stuck for 3+ seconds
 * - morphological: Wrong word ending
 *
 * NOT ERRORS (diagnostic only):
 * - insertion: Extra word (per ORF standards)
 * - fragment: False start (merged into target)
 * - repetition: Self-correction attempt
 * - hesitation: Brief pause (< 3s)
 * - selfCorrection: Repeated word/phrase or near-miss attempt before correct word
 * - ghost: STT hallucination (filtered)
 * - possibleInsertion: Uncertain extra word
 * - properNounForgiveness: Close attempt at name
 * - terminalLeniency: Recording cut off
 * - reverb_filler: Filler word (um, uh) via Reverb model diff
 * - reverb_repetition: Word repetition via Reverb model diff
 * - reverb_false_start: False start via Reverb model diff
 */
