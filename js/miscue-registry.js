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
// ALIGNMENT-BASED MISCUES (detected via Needleman-Wunsch in alignment.js)
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
// REVERB DISFLUENCY MISCUES (detected in app.js via V1/V0 insertion diff)
// Model-level disfluencies from Reverb verbatim vs clean comparison
// ============================================================================

const REVERB_DISFLUENCY_MISCUES = {
  reverb_filler: {
    description: 'Filler word detected by Reverb verbatim/clean diff (um, uh, er, ah, mm, hmm)',
    detector: 'app.js → disfluency classification block (FILLER_WORDS check + pre-filtered tagging)',
    countsAsError: false,
    config: null,
    example: {
      reference: 'the cat sat',
      spoken: 'the um cat sat',
      result: '"um" detected as filler — V1 insertion matched FILLER_WORDS set, or pre-filtered before alignment and retroactively tagged'
    },
    uiClass: 'word-disfluency',
    note: 'Two detection paths: (1) V1 insertion matching FILLER_WORDS → isDisfluency=true. (2) Pre-filtered fillers stripped by alignment.js DISFLUENCIES set → retroactively tagged on transcriptWords after alignment.'
  },

  reverb_false_start: {
    description: 'False start (partial word) detected by V1/V0 insertion diff',
    detector: 'app.js → disfluency classification block (V1 insertion present, V0 insertion absent)',
    countsAsError: false,
    config: null,
    example: {
      reference: 'the cat sat',
      spoken: 'the ca- cat sat',
      result: '"ca-" is a V1 insertion absent from V0 → tagged as false_start'
    },
    uiClass: 'word-disfluency',
    note: 'V0 (clean) language model suppresses partial words and repetitions. If a V1 insertion is not in V0 insertions, V0 deemed it a disfluency.'
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
    description: 'Extended silence (3+ seconds) indicating student got stuck. Displayed as a visual [pause] marker between words.',
    detector: 'diagnostics.js → detectLongPauses()',
    countsAsError: false, // Indicator only — does not affect accuracy
    config: {
      LONG_PAUSE_THRESHOLD_SEC: 3.0
    },
    example: {
      context: '"the" ends at 1.0s, "dog" starts at 5.5s',
      result: '4.5s gap flagged as long pause — [pause] marker shown between words'
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
      min_diff_chars: 2,                 // Must differ by 2+ chars (skips "formats"/"format")
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

  wordByWord: {
    description: 'Student reads with uniform pauses between most words, indicating word-by-word decoding rather than phrase-level reading',
    detector: 'diagnostics.js → computePhrasingQuality() → readingPattern',
    countsAsError: false, // Reading pattern diagnostic, not a per-word error
    config: {
      thresholds: {
        wordByWord: 0.350,  // medianGap > 350ms
        choppy: 0.250,      // medianGap > 250ms
        phraseLevel: 0.150  // medianGap > 150ms
      }
    },
    example: {
      context: 'Student reads "The... cat... sat... on... the... mat" with ~400ms between every word',
      result: 'medianGap = 0.412 → classification: word-by-word'
    }
  },

  struggle: {
    description: 'Substitution+ — student failed to produce the word, with additional evidence of decoding difficulty (long pause, near-miss fragments, and/or abandoned attempt). Always an error.',
    detector: 'app.js (3-way compound struggle) + diagnostics.js → resolveNearMissClusters() (Path 2: decoding) + detectStruggleWords() (Path 1: hesitation, Path 3: abandoned attempt)',
    countsAsError: true, // Struggle = substitution+ = always an error
    config: {
      // Path 1: substitution + pause >= 3s + ref word > 3 chars
      pause_threshold_s: 3,
      // Path 2: substitution + near-miss insertions + ref word >= 3 chars
      near_miss_min_shared_affix: 3,     // Shared prefix or suffix >= 3 chars
      near_miss_levenshtein_threshold: 0.4, // Or Levenshtein ratio >= 0.4
      min_word_length: 4,                // Reference word > 3 chars (4+)
      // Path 3: substitution + crossValidation 'unconfirmed' (cross-validator N/A) + near-miss
      // No min_word_length gate — near-miss check provides sufficient signal
    },
    example: {
      context: 'Path 2: Student says "sta", "tieion", "staion" for "station". Path 3: Student says "cont" for "content\'s" — only verbatim STT detected it, cross-validator heard nothing.',
      result: 'Substitution upgraded to struggle via matching pathway(s)'
    },
    uiClass: 'word-struggle',
    pathways: {
      hesitation: 'Path 1: substitution + 3s+ pause before the word → student hesitated then failed',
      decoding: 'Path 2: substitution + near-miss insertions around it → multiple failed decoding attempts',
      abandoned: 'Path 3: substitution + cross-validator N/A + near-miss match → partial/garbled attempt only verbatim STT detected',
      compound_fragments: 'Compound struggle: correct + compound merge with 2+ fragments in V1 alignment (e.g., "spread"+"sheet" → "spreadsheet"). Detected via 3-way independent reference alignment — V1 needed fragment collapsing to match reference, indicating acoustic difficulty.'
    },
    fragmentAbsorption: {
      description: 'When Reverb fragments a single utterance into multiple BPE tokens (e.g., "platforms" → "pla" + "for"), orphan insertions are absorbed into the parent mispronunciation using temporal containment. NOTE: Pre-alignment reference-aware fragment merge (app.js) now handles many of these cases upstream — adjacent short Reverb words whose concatenation matches a reference word are merged before NW alignment. This post-alignment absorption remains as a safety net for cases that escape the pre-merge.',
      detector: 'diagnostics.js → absorbMispronunciationFragments()',
      mechanism: 'If an insertion\'s hypIndex falls within ±1 of a nearby substitution/struggle entry and its Reverb timestamp is within the substitution\'s xval time window (±150ms), it is flagged _partOfStruggle and excluded from insertion count.',
      tolerance: '150ms on xval timestamp window edges',
      guards: ['Insertion must not already be _isSelfCorrection', 'Uses hypIndex for direct timestamp lookup from transcriptWords', 'Absorbs orphan BPE fragments into parent mispronunciation'],
      concatenatedFragments: {
        description: 'When individual insertions fail isNearMiss (e.g., "var" vs "overall" = 0.286 < 0.4), concatenation of consecutive unclaimed insertions + the substitution hyp is tried (e.g., "var"+"all" = "varall" vs "overall" passes shared suffix "all" >= 3 chars). Runs as second pass in resolveNearMissClusters after individual checks.',
        detector: 'diagnostics.js → resolveNearMissClusters() (concatenation pass)',
        guards: ['Max 3 insertions concatenated', 'Each insertion >= 2 chars', 'Combined length <= 2× ref length', 'Skips already-claimed insertions (_partOfStruggle, _isSelfCorrection)'],
        fields: '_concatAttempt on the substitution entry stores the combined form for tooltip enrichment'
      }
    },
    note: 'A word can match multiple pathways simultaneously. Paths 1-3 require a substitution base (student said wrong word). Compound fragments pathway reclassifies correct words where V1 compound merge combined 2+ fragments — detected via independent 3-way reference alignment (V1, V0, Parakeet each aligned to reference separately).'
  },

  reverbCtcFailure: {
    description: 'Reverb produced a CTC special token (<unknown>, <unk>, <blank>) — speech was detected but could not be decoded into a word. Cross-validator heard a real word. Substitution is preserved; (!) badge flags single-source evidence.',
    detector: 'js/ui.js:997 (badge condition), js/ui.js:214 (tooltip)',
    countsAsError: true, // substitution scoring unchanged
    config: {},          // no thresholds — purely display
    example: {
      reference: 'publication',
      spoken: 'Reverb → <unknown>, Parakeet → "publication"',
      result: 'Substitution with (!) badge. Teacher sees orange word with warning: only Parakeet provides evidence.'
    },
    uiClass: 'word-recovered-badge',
    note: 'Reverb CTC failure means the acoustic signal was too garbled for CTC decoding. The cross-validator (Parakeet/Deepgram) may have heard a word, but it is single-source evidence. The (!) badge warns the teacher to verify by listening. Single-BPE-token (≤120ms) <unknown> tokens that overlap a confirmed word are flagged as _ctcArtifact and hidden from the teacher-facing "Inserted words" section (but preserved in data and STT Transcript). See ctcArtifactFilter below.'
  }
};

// ============================================================================
// PRE-ALIGNMENT FIXES (app.js, cross-validator.js)
// These correct ASR artifacts before words reach NW alignment
// ============================================================================

const PRE_ALIGNMENT_FIXES = {
  ctcArtifactFilter: {
    description: 'Flags single-BPE-token <unknown> tokens as CTC artifacts when they temporally overlap a confirmed word. These are onset/offset decoding failures — Reverb CTC could not classify the first frame of a word the student actually said. Flagged tokens (_ctcArtifact: true) are hidden from the teacher-facing "Inserted words" section but preserved in transcriptWords, debug JSON, and STT Transcript view.',
    detector: 'app.js → CTC artifact flag block (before sttLookup build); ui.js → regularInsertions filter',
    countsAsError: false, // hidden from teacher view, does not affect scoring
    config: {
      maxDurationMs: 120,       // single BPE token = 100ms (wenet g_time_stamp_gap_ms); 120ms for float margin
      overlapToleranceMs: 200   // ±200ms tolerance for timestamp overlap with confirmed word
    },
    example: {
      reference: 'Visuals',
      spoken: 'Reverb → <unknown> (1.75s–1.85s, 100ms) then "visuals" (2.07s), Parakeet → "Visuals" (1.76s–2.64s)',
      result: '<unknown> flagged _ctcArtifact: true. Hidden from "Inserted words" section. Still visible in STT Transcript and debug JSON.'
    },
    guards: [
      'Must be a special ASR token (word starts with < and ends with >)',
      'Duration must be ≤120ms (single BPE token)',
      'Must temporally overlap (±200ms) with at least one confirmed transcriptWord'
    ],
    note: 'A single-BPE-token <unknown> overlapping a confirmed word is almost certainly the CTC decoder failing to decode the onset of that word. However, it could theoretically be an imperceptible micro-stutter. Data is preserved (not deleted) so future analysis can revisit this decision.'
  },

  preAlignmentFragmentMerge: {
    description: 'Merges adjacent short Reverb BPE fragments into a single token before NW alignment when their concatenation matches a reference word. Reference-aware approach (Plan 5) replaces cross-validator-anchored merging.',
    detector: 'app.js → reference-aware fragment pre-merge block (after hyphen split, before sttLookup)',
    countsAsError: false, // Corrective — reduces false errors
    config: {
      MAX_FRAG_LEN: 4,                  // Fragments must be short (≤ 4 chars)
      MAX_GAP_S: 0.3,                   // Fragments must be temporally adjacent (< 300ms gap)
      referenceSet: 'refNormSet from normalizeText(referenceText)'
    },
    example: {
      reference: 'ideation',
      spoken: 'Reverb → "i" + "d", reference contains "ideation"',
      result: 'Fragments "i"+"d" = "id" — prefix of reference word "ideation". Merged to "id" before alignment. NW sees ref="ideation" vs hyp="id" — near-miss substitution instead of orphan insertion + meaningless sub.'
    },
    guards: [
      'All fragments must be short (≤ MAX_FRAG_LEN chars)',
      'Concatenation must exist in refNormSet (reference-anchored)',
      'Fragments must be temporally adjacent (< MAX_GAP_S gap between Reverb timestamps)',
      'First word in sequence preserved, subsequent words spliced out'
    ],
    note: 'Reverb BPE tokenization sometimes splits a single spoken word into multiple fragments (e.g., "ideation" → "i" + "d"). Without merging, each fragment enters alignment separately, producing an orphan insertion and a meaningless substitution. The reference-aware merge uses normalizeText(referenceText) as anchor instead of cross-validator timestamps.'
  },

  tier1NearMatchOverride: {
    description: 'When Tier 1 fuzzy match (similarity >= 0.8) has edit distance <= 1 on a long word, use the cross-validator word text instead of Reverb. Prevents false substitutions from minor Reverb transcription differences (e.g., dropped plural "s").',
    detector: 'app.js → crossValidateByReference() (near-match logic inherited from Plan 5)',
    countsAsError: false, // Corrective — reduces false errors
    config: {
      similarityThreshold: 0.8,         // Must already be Tier 1 (high similarity)
      maxEditDistance: 1,                // Single character difference
      minWordLength: 5                  // Long words only (short words: 1 char IS the difference)
    },
    example: {
      reference: 'formats',
      spoken: 'Reverb → "format", Parakeet → "formats"',
      result: 'Similarity 0.857 (Tier 1), editDist=1, maxLen=7. Cross-validator word "formats" overrides Reverb "format". Alignment sees correct match.'
    },
    note: 'Previously, Tier 1 always kept Reverb word text. For single-char differences on long words (like dropped plural "s"), the cross-validator is more likely correct. Now promotes to nearMatch so wordOverride applies, same as Tier 2a.'
  }
};

// ============================================================================
// ABBREVIATION HANDLING (alignment.js + app.js)
// These prevent false errors when reference text contains abbreviations
// ============================================================================

const ABBREVIATION_RULES = {
  abbreviationCompoundMerge: {
    description: 'Internal-period abbreviation (i.e., e.g., U.S.) stripped to letter sequence and merged via compound word detection when ASR outputs individual letters',
    detector: 'text-normalize.js → normalizeText() (period strip) + alignment.js → mergeCompoundWords()',
    countsAsError: false, // Correctly read abbreviation, not an error
    config: {
      periodStrip: 'normalizeText strips all internal periods: "i.e." → "ie"',
      compoundMerge: 'Existing mergeCompoundWords matches sub(ref="ie", hyp="i") + ins(hyp="e") → correct'
    },
    example: {
      reference: 'content-i.e., who',
      spoken: '"eye ee"',
      result: 'Reverb: "i"+"e" → compound merge: "i"+"e"="ie" → correct'
    }
  },

  abbreviationExpansionMerge: {
    description: 'Multi-word abbreviation expansion where student reads the full meaning instead of letter-by-letter',
    detector: 'alignment.js → mergeAbbreviationExpansions()',
    countsAsError: false,
    config: {
      expansions: 'ABBREVIATION_EXPANSIONS table in alignment.js (ie→"that is", eg→"for example", etc.)',
      position: 'Runs after mergeCompoundWords, before mergeContractions'
    },
    example: {
      reference: 'i.e.',
      spoken: '"that is"',
      result: 'sub(ref="ie", hyp="that") + ins(hyp="is") → matches expansion → correct'
    }
  },

  xvalAbbreviationConfirmation: {
    description: 'Cross-validator (Parakeet/Deepgram) confirms abbreviation reading when primary ASR (Reverb) splits it into fragments',
    detector: 'app.js → cross-validator abbreviation confirmation step (after omission recovery)',
    countsAsError: false,
    config: {
      mechanism: 'Parakeet ITN reassembles spoken letters back to written form (e.g., "eye ee" → "i.e.")',
      guard: 'Ref must be ≤5 chars (abbreviation-shaped) AND hyp must be ≤2 chars (single letter fragment)'
    },
    example: {
      reference: 'i.e.',
      spoken: '"eye ee"',
      result: 'Reverb: sub("ie"/"e"), Parakeet: confirmed "i.e." → reclassify as correct'
    }
  }
};

// ============================================================================
// NUMBER EXPANSION HANDLING (alignment.js)
// Prevents false errors when reference text contains digits read as words
// ============================================================================

const NUMBER_EXPANSION_RULES = {
  numberExpansionMerge: {
    description: 'Multi-word number expansion where student reads digits as spoken words (e.g., "2014" → "twenty fourteen")',
    detector: 'alignment.js → mergeNumberExpansions() + number-words.js → numberToWordForms()',
    countsAsError: false,
    config: {
      range: 'Integers 0–9999',
      forms: 'Year-style (twenty fourteen), formal (two thousand fourteen), British (two thousand and fourteen), oh-style (twenty oh four)',
      position: 'Runs after mergeAbbreviationExpansions, before mergeContractions'
    },
    example: {
      reference: '2014',
      spoken: '"twenty fourteen"',
      result: 'sub(ref="2014", hyp="twenty") + ins(hyp="fourteen") → matches year-style expansion → correct'
    },
    note: 'Single-word numbers (1–100) are already handled by word-equivalences.js. This covers multi-word forms for larger numbers. Flagged _numberExpansion: true to skip compound struggle reclassification.'
  }
};

// ============================================================================
// FORGIVENESS RULES (detected in metrics.js / alignment post-processing)
// These identify errors that should NOT count against the student
// ============================================================================

const FORGIVENESS_RULES = {
  properNounForgiveness: {
    description: 'Phonetically close attempt at a proper noun (name), with dictionary guard to exclude common English words',
    detector: 'app.js → forgiveness loop (NL API proper noun detection + Free Dictionary API guard)',
    countsAsError: false, // Forgiven - student decoded correctly, just unfamiliar
    config: {
      min_similarity: 0.40,              // 40% Levenshtein similarity required
      dictionary_api: 'https://api.dictionaryapi.dev/api/v2/entries/en/{word}',
      dictionary_cache: 'sessionStorage (key: dict_{word})',
      // 200 = common word → skip forgiveness (student should know this word)
      // 404 = exotic name → allow forgiveness
    },
    example: {
      reference: 'Mallon',
      spoken: 'Malone',
      result: 'Proper noun + dictionary 404 (exotic name) + phonetically close = forgiven'
    },
    guards: [
      'NL API must identify word as proper noun (isProperViaNL)',
      'Reference text lowercase override: if word appears lowercase elsewhere, NOT proper',
      'Dictionary guard: if Free Dictionary API returns 200, word is common English → NOT forgiven',
      'Capitalization is cosmetic only — no isProperViaCaps fallback'
    ],
    uiClass: 'word-forgiven',
    note: 'Student used phonics correctly but doesn\'t know the name. Common words like "north", "straight" are blocked by dictionary lookup even if NL API tags them as proper nouns.'
  }
};

// ============================================================================
// SEVERITY LEVELS
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

  // Reverb disfluencies (V1/V0 insertion diff in app.js)
  ...REVERB_DISFLUENCY_MISCUES,

  // Diagnostics (fluency indicators)
  ...DIAGNOSTIC_MISCUES,

  // Pre-alignment fixes
  ...PRE_ALIGNMENT_FIXES,

  // Abbreviation handling
  ...ABBREVIATION_RULES,

  // Number expansion handling
  ...NUMBER_EXPANSION_RULES,

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
 * - morphological: Wrong word ending
 * - reverbCtcFailure: Reverb CTC failure (<unknown>) — substitution with (!) weak-evidence badge
 *
 * NOT ERRORS (diagnostic only):
 * - insertion: Extra word (per ORF standards)
 * - longPause: 3+ second gap (visual indicator only)
 * - hesitation: Brief pause (< 3s)
 * - selfCorrection: Repeated word/phrase or near-miss attempt before correct word
 * - properNounForgiveness: Close attempt at name
 * - reverb_filler: Filler word (um, uh) via V1/V0 diff or pre-filter tagging
 * - reverb_false_start: False start via V1/V0 insertion diff
 * - abbreviationCompoundMerge: i.e./e.g./U.S. read letter-by-letter → compound merged
 * - abbreviationExpansionMerge: i.e. read as "that is" → expansion merged
 * - numberExpansionMerge: "2014" read as "twenty fourteen" → expansion merged
 * - xvalAbbreviationConfirmation: Cross-validator confirms abbreviation reading
 * - preAlignmentFragmentMerge: Reverb BPE fragments merged before alignment ("i"+"d" → "id")
 * - tier1NearMatchOverride: Tier 1 fuzzy match uses xval word for 1-char diffs ("format"→"formats")
 *
 * INFRASTRUCTURE FIXES:
 * - sttLookup keys use raw normalized words (not getCanonical) to match alignment hyp values
 * - Debug logger reads version from #version div (not hardcoded constant)
 */
