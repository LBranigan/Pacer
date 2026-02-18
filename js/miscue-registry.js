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
    countsAsError: false, // Per ORF standard, insertions never count as errors
    config: null,
    example: {
      reference: 'the dog',
      spoken: 'the big dog',
      result: '"big" is an insertion'
    },
    uiClass: 'word-insertion'
  },

  confirmed_insertion: {
    description: 'Student added a word not in the reference passage, confirmed by V1 + Parakeet at the same ref-word boundary. Strong evidence the student actually said an extra word.',
    detector: 'app.js → insertion cross-validation (after alignment, grouped by ref-word boundary)',
    countsAsError: false, // Per ORF standard, insertions never count as errors (still tracked/displayed)
    config: {
      requirement: 'V1 + Parakeet must hear the same normalized word at the same ref-word boundary position (V0 excluded from scoring)',
      exclusions: 'Fillers (isDisfluency), struggle fragments (_partOfStruggle), CTC artifacts (_ctcArtifact) are excluded'
    },
    example: {
      reference: 'the dog',
      spoken: 'the big dog',
      result: 'V1 hears "big", Parakeet hears "big" → _confirmedInsertion: true → counts as error'
    },
    uiClass: 'word-bucket-confirmed-insertion',
    note: 'Rendered inline in word flow (not as fragment) with its own bucket color. The "+" prefix in display text indicates an added word. Regular insertions (single-engine or 2-engine) remain non-errors and show in the "Inserted words" section.'
  }
};

// ============================================================================
// REVERB DISFLUENCY MISCUES (detected in app.js via V1 keyword matching)
// Model-level disfluencies from Reverb verbatim pass
// ============================================================================

const REVERB_DISFLUENCY_MISCUES = {
  reverb_filler: {
    description: 'Filler word detected via FILLER_WORDS set (um, uh, er, ah, mm, hmm)',
    detector: 'app.js → filler classification block (FILLER_WORDS check on V1 insertions + transcriptWords)',
    countsAsError: false,
    config: null,
    example: {
      reference: 'the cat sat',
      spoken: 'the um cat sat',
      result: '"um" detected as filler — V1 insertion or pre-filtered word matched FILLER_WORDS set'
    },
    uiClass: 'word-fragment',
    note: 'Two detection paths: (1) V1 alignment insertion matching FILLER_WORDS → isDisfluency=true. (2) Pre-filtered fillers stripped by alignment.js DISFLUENCIES before NW alignment, then re-injected as insertion entries with _preFilteredDisfluency flag after merge pipeline. Both paths tag transcriptWords[idx].isDisfluency=true. UI renders all fragments (fillers and non-fillers) with same .word-fragment styling. isDisfluency flag still used internally for insertion count exclusion in diagnostics.js.'
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
    description: 'Student made a false start or repetition then produced the correct word — indicates error awareness and monitoring.',
    detector: 'app.js → Self-Correction Detection pass (after fragment absorption)',
    countsAsError: false,
    config: {
      conditions: [
        '(a) Forgiven substitution with _nearMissEvidence (failed attempt + override)',
        '(b) Forgiven substitution with _fullAttempt.length > 1 (multiple fragments → correct)',
        '(c) Correct/forgiven entry + adjacent insertion exactly matches ref (repetition)',
        '(d) Correct/forgiven entry + adjacent insertion is isNearMiss() of ref (false start)'
      ],
      filters: 'Fillers excluded (uh, um, ah, er, hm, mm). Both words must be >= 2 chars.'
    },
    example: {
      reference: 'faced / again',
      spoken: '"fact faced" / "again again"',
      result: 'SC badge — false start "fact" before "faced", or repetition "again"'
    },
    flags: {
      _selfCorrected: 'true on the alignment entry',
      _selfCorrectionEvidence: 'Array of evidence words (e.g., ["fact"])',
      _selfCorrectionReason: '"repetition" | "near-miss-insertion" | "near-miss-evidence" | "full-attempt"'
    },
    uiClass: 'word-sc'
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
    description: 'Substitution+ — student failed to produce the word, with additional evidence of decoding difficulty (long pause, near-miss fragments, and/or abandoned attempt). Always an error. Not a separate type — flagged via _isStruggle on substitution (or correct for compound) entries.',
    detector: 'app.js (3-way compound struggle) + diagnostics.js → resolveNearMissClusters() (Path 2: decoding) + detectStruggleWords() (Path 1: hesitation, Path 3: abandoned attempt)',
    countsAsError: true, // Struggle = substitution+ = always an error (flag: _isStruggle)
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
      guards: ['Uses hypIndex for direct timestamp lookup from transcriptWords', 'Absorbs orphan BPE fragments into parent mispronunciation'],
      concatenatedFragments: {
        description: 'When individual insertions fail isNearMiss (e.g., "var" vs "overall" = 0.286 < 0.4), concatenation of consecutive unclaimed insertions + the substitution hyp is tried (e.g., "var"+"all" = "varall" vs "overall" passes shared suffix "all" >= 3 chars). Runs as second pass in resolveNearMissClusters after individual checks.',
        detector: 'diagnostics.js → resolveNearMissClusters() (concatenation pass)',
        guards: ['Max 3 insertions concatenated', 'Each insertion >= 2 chars', 'Combined length <= 2× ref length', 'Skips already-claimed insertions (_partOfStruggle)'],
        fields: '_concatAttempt on the substitution entry stores the combined form for tooltip enrichment'
      },
      fullAttemptReconstruction: {
        description: 'After all fragment absorption and near-miss resolution, reconstructs the student\'s full attempt at a word by walking backward/forward from the struggle entry to collect all adjacent _partOfStruggle insertions + main hyp. Computes syllable coverage and similarity on the full attempt rather than fragments individually.',
        detector: 'app.js → syllable coverage annotation block (walks alignment array from struggle entry)',
        fields: {
          _fullAttempt: 'Array of fragment strings in reading order (e.g., ["bar", "a", "coda"])',
          _fullAttemptJoined: 'Concatenated attempt string (e.g., "baracoda")',
          _fullAttemptRatio: 'levenshteinRatio(fullAttemptJoined, ref) — similarity to reference word'
        },
        example: {
          reference: 'barracuda',
          spoken: '"bar" + "a" + "coda"',
          before: '_nearMissEvidence: ["bar"] → syllable coverage 1/4 (25%) — only pass 1 fragment',
          after: '_fullAttempt: ["bar","a","coda"] → "baracoda" → syllable coverage 3/4 (75%)'
        },
        note: 'Fixes undercounting where _nearMissEvidence only contained pass 1 fragments but absorbMispronunciationFragments added more _partOfStruggle insertions (like single-char "a") that were missed. The full attempt gives downstream AI the complete picture of what the student produced.'
      }
    },
    note: 'A word can match multiple pathways simultaneously. Paths 1-3 require a substitution base (student said wrong word). Compound fragments pathway reclassifies correct words where V1 compound merge combined 2+ fragments — detected via independent reference alignment (V1 and Parakeet each aligned to reference separately; V0 is display-only).'
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

  spilloverConsolidation: {
    description: 'After NW alignment, identifies ref slots where the hyp is not a real attempt at that ref word but is a spillover fragment from a preceding struggle. Converts the spillover entry to an omission and emits the hyp as an insertion after the anchor word, preserving struggle evidence.',
    detector: 'alignment.js → consolidateSpilloverFragments() (called per-engine in app.js after alignWords)',
    countsAsError: false, // Corrective — reassigns fragments to correct ref slot
    config: {
      guards: [
        'candidate.hyp must NOT be a near-miss for candidate.ref (not a real attempt)',
        'concat(anchor.hyp, candidate.hyp) must BE a near-miss for anchor.ref (spillover evidence)',
        'Progressive chaining: tries anchor + candidate, anchor + candidate + next candidate, etc.'
      ]
    },
    example: {
      reference: '"true" "informational" "expert" "for"',
      spoken: 'Reverb: "true" "in" "four" "uh" "for"',
      before: 'NW: correct("true"), sub("informational"←"in"), sub("expert"←"four"), ins("uh"), correct("for")',
      after: 'correct("true"), sub("informational"←"in"), ins("four",_spillover), ins("uh",_spillover), omission("expert",_spilloverOmission), correct("for")',
      result: '"infour" near-miss for "informational" → resolveNearMissClusters upgrades to struggle; "expert" recovered by Parakeet in 3-way verdict'
    },
    note: 'Runs independently per engine (V1, V0, Parakeet) after alignWords() and before comparison. Uses only the engine\'s own data — no cross-engine dependency. Modifies alignment array in place. V0 alignment is computed for display but excluded from scoring decisions.'
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
  postStruggleLeniency: {
    description: 'After a confirmed error (substitution, struggle, omission, confirmed insertion), Reverb CTC often fails to recover for the immediately following word. If Parakeet independently heard the next word correctly and V1 produced a disagreed substitution, promote to correct. One word of leniency only.',
    detector: 'app.js → post-struggle Parakeet leniency block (after confirmed-insertion clearance, before metrics)',
    countsAsError: false,
    config: {
      conditions: [
        'Previous ref-anchored entry was an error (substitution, struggle, omission) and not forgiven',
        'OR a confirmed insertion occurred between the two ref words',
        'Current entry is a substitution with crossValidation === "disagreed"',
        'Parakeet ref entry at same index has type === "correct"'
      ],
      oneWordRule: 'After promotion, entry becomes correct → prevRefWasError resets → next word gets no leniency'
    },
    example: {
      reference: 'publishing stool',
      spoken: 'Reverb: "pub-lishing" (struggle) then "four" (wrong), Parakeet: "stool" (correct)',
      result: '"stool" promoted to correct with _postStruggleLeniency flag — Reverb was still off-track from "publishing" struggle'
    },
    uiClass: 'word-bucket-struggle-correct',
    note: 'entry.hyp is NOT changed — keeps V1 original word for evidence. entry._postStruggleLeniency: true flag drives UI bucket classification and tooltip.'
  },

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
  },

  properNounOmissionForgiveness: {
    description: 'Proper noun scored as omission by V1 (Reverb fragmented the attempt) but Parakeet captured a near-miss. Student attempted the word — ASR fragmentation caused the false omission.',
    detector: 'app.js → forgiveness loop (omission branch, uses _xvalWord or preceding insertion fragments)',
    countsAsError: false,
    config: {
      min_similarity: 0.40,
      primary_evidence: '_xvalWord (Parakeet hearing)',
      secondary_evidence: 'preceding insertion fragments concatenated',
    },
    example: {
      reference: 'Escondido',
      spoken: '(Reverb: "so" + "ascal" + "deal"; Parakeet: "Escaldio")',
      result: 'Proper noun + _xvalWord "escaldio" → 67% similar → forgiven'
    },
    guards: [
      'Same guards as properNounForgiveness (NL API, dictionary, lowercase)',
      'Must have _xvalWord (Parakeet) or preceding insertion fragments as evidence',
      'Evidence must meet 0.4 Levenshtein threshold against ref word',
    ],
    uiClass: 'word-forgiven',
    note: 'Reverb CTC fragments non-English words into meaningless tokens. Parakeet (or fragment concatenation) provides evidence the child actually attempted the word. Sets _forgivenEvidence and _forgivenEvidenceSource on the entry.'
  },

  inflectionalForgiveness: {
    description: 'Substitution where ref and hyp differ by only an inflectional suffix — student decoded the base word correctly. Forgiven as meaning-preserving.',
    detector: 'app.js → Phase 1.5 inflectional forgiveness loop',
    countsAsError: false,
    config: {
      suffixes: ['s', 'es', 'ed', 'd', 'ing', 'er', 'est', 'ly'],
      min_base_length: 3,       // shorter word must be >= 3 chars
      match_rule: 'longer.startsWith(shorter) && suffix in list',
    },
    example: {
      reference: 'schools',
      spoken: 'school',
      result: '"school" for "schools" — dropped -s suffix → forgiven (_inflectionalVariant: true)'
    },
    guards: [
      'One word must start with the other (pure suffix difference)',
      'Remaining suffix must be in the inflectional suffix whitelist',
      'Shorter word (base) must be >= 3 characters',
      'Not already forgiven by another mechanism (proper noun, OOV)',
    ],
    uiClass: 'word-forgiven',
    note: 'Justified by Florida FAIR precedent (inflectional endings not errors), AAE dialect fairness (rule-governed suffix dropping), ASR unreliability on word-final morphemes, and miscue analysis research (morphological variants preserve meaning). Bidirectional: forgives both dropped suffixes ("school" for "schools") and added suffixes ("schools" for "school").'
  },

  oovOmissionRecovery: {
    description: 'Out-of-vocabulary reference word scored as omission, but <unknown> CTC tokens exist in the temporal window — student vocalized something but ASR could not decode it because the word is not in its vocabulary. Excluded from assessment (neither correct nor error).',
    detector: 'app.js → OOV omission recovery loop (inside OOV forgiveness block, after phonetic forgiveness)',
    countsAsError: false,
    config: {
      oovDetection: 'getPhonemeCount(refNorm) === null — word not in CMUdict',
      temporalWindow: 'From adjacent non-insertion alignment entries\' timestamps ±0.5s',
      unknownTokenDetection: 'transcriptWords where word starts with < and ends with >, excluding _ctcArtifact'
    },
    example: {
      reference: 'cayuco',
      spoken: 'Reverb → two <unknown> tokens at 31s and 32s',
      result: 'OOV omission + <unknown> tokens in window → excluded (_oovExcluded: true)'
    },
    guards: [
      'Reference word must be OOV (_isOOV: true)',
      'Entry must be an omission (type === "omission")',
      'At least one <unknown> token in temporal window',
      'CTC artifacts excluded (_ctcArtifact tokens skipped)'
    ],
    uiClass: 'word-forgiven',
    note: 'Now sets _oovExcluded: true in addition to forgiven: true. Word is excluded from assessment entirely (not counted as correct). Part 1 (reassignment) runs first and may convert the omission to a substitution by stealing a <unknown> from a donor — in that case this path skips the entry and Part 2 handles exclusion instead.'
  },

  oovExcluded: {
    description: 'OOV word with <unknown> token that phonetic forgiveness could not match. Excluded from assessment entirely — neither correct nor error. Student attempted the word but ASR could not decode it.',
    detector: 'app.js → OOV exclusion block (Part 2, after existing OOV omission recovery)',
    countsAsError: false,
    config: {
      mechanism: 'OOV entry has hyp="unknown" from <unknown> token + phonetic match < 0.6',
      timeCredit: 'Gap between last confirmed word before and first confirmed word after OOV cluster',
      adjacentClustering: 'Adjacent OOV-excluded entries share one time window (no double-counting)'
    },
    example: {
      reference: 'cayuco',
      spoken: 'Reverb → <unknown> tokens, Parakeet → speech detected but undecodable',
      result: 'OOV-excluded (_oovExcluded: true), forgiven, time credited back'
    },
    guards: [
      'Reference word must be OOV (_isOOV: true)',
      'Entry must have hyp="unknown" from verified <unknown> CTC token',
      'Phonetic forgiveness (path 1) must not have fired',
      'Raw transcriptWords[hypIndex].word must match <...> pattern',
      'CTC artifacts excluded (_ctcArtifact tokens skipped in Part 1)'
    ],
    uiClass: 'word-forgiven',
    note: 'Appears with dashed green border + checkmark in analyzed words view. Tooltip explains OOV exclusion. Time credit reflected in WCPM tooltip. Two entry points: (1) Part 1 reassigns donor → Part 2 excludes the OOV substitution, (2) existing path 2 excludes the OOV omission directly when no donor found.'
  },

  functionWordCollateral: {
    description: 'Single-letter function word ("a", "I") omitted by all engines and adjacent to OOV/struggle word. Forgiven as collateral damage — word too short for ASR when student struggling nearby.',
    detector: 'app.js → function word forgiveness block (Part 4, after clear-confirmed-insertions, before post-struggle leniency)',
    countsAsError: false,
    config: {
      FUNCTION_LETTERS: ['a', 'i'],
      requirement: 'Omitted by scoring engines (V1, Parakeet) at this ref position',
      adjacency: 'Adjacent non-insertion ref entry must be OOV, struggle, substitution, or _oovExcluded'
    },
    example: {
      reference: 'cayuco a small',
      spoken: 'Reverb → [unknown tokens], Parakeet → no "a" detected',
      result: '"a" forgiven — all engines missed it, adjacent to OOV struggle'
    },
    guards: [
      'Reference word must be single letter: "a" or "I"',
      'Entry type must be omission',
      'Scoring engines (V1 + Pk) must have omission at this ref position (checked via _threeWay)',
      'Must be adjacent (in ref-word space, skipping insertions) to OOV or struggle entry',
      'Entry must not already be forgiven'
    ],
    uiClass: 'word-forgiven',
    note: 'Uses _threeWay.pkRef[refIdx] for Parakeet verification. V0 data still stored for display but not checked for scoring decisions. refIdx tracked by incrementing counter for each non-insertion alignment entry (same pattern as post-struggle leniency).'
  },

  oovPhoneticForgiveness: {
    description: 'Out-of-vocabulary reference word (not in CMUdict) that the student pronounced phonetically close enough to forgive. ASR engines can\'t recognize foreign/rare words absent from their training vocabulary, so string comparison produces false errors.',
    detector: 'app.js → OOV forgiveness loop (after proper noun forgiveness, uses phoneticNormalize + levenshteinRatio)',
    countsAsError: false,
    config: {
      oovDetection: 'getPhonemeCount(refNorm) === null — word not in CMUdict (125K English words)',
      phoneticNormalization: 'Collapse ck→k, ph→f, c→k before Levenshtein comparison',
      min_similarity: 0.60,
      min_ref_length: 3,
      skip_digits: true,
      skip_already_forgiven: true
    },
    example: {
      reference: 'cayuco',
      spoken: 'Reverb → "ca" + "yoko", Parakeet → "Kayoko"',
      result: 'phoneticNormalize: "kayuko" vs "kayoko" → ratio 0.83 ≥ 0.6 → forgiven'
    },
    guards: [
      'Reference word must be ≥ 3 chars',
      'Reference word must not contain digits (handled by number expansion)',
      'Reference word must not already be forgiven (proper noun)',
      'Only substitutions and struggles are candidates (omissions = student didn\'t attempt)',
      'Best ratio across all engine hearings must be ≥ 0.6'
    ],
    uiClass: 'word-forgiven',
    note: 'Foreign words (Spanish "cayuco", French "château") and rare English words absent from CMUdict trigger OOV detection. Phonetic normalization collapses common equivalences (c/k, ph/f, ck/k) before Levenshtein comparison. Adjacent insertion fragments from ASR splitting are cleaned up (_partOfOOVForgiven).'
  },
  endOfReadingDetection: {
    description: 'Trailing reference words where no ASR engine produced anything near-miss to the reference, indicating the student had stopped reading and post-reading speech (proctor, environmental) was force-aligned against non-passage reference text.',
    detector: 'app.js → Phase 8: End-of-reading detection (backward walk from alignment end)',
    countsAsError: false,
    config: {
      comparison: 'isNearMiss(engineWord, refWord) checked for V1 and Parakeet (V0 excluded from scoring)',
      stopCondition: 'Walk stops at first correct, forgiven, or near-miss entry',
      omissionPolicy: 'Trailing omissions only marked if a not-attempted substitution exists after them'
    },
    example: {
      reference: '...war always takes. Enter your reading time below.',
      spoken: 'Reverb: "...takes jacobs hot oh emma we\'re done"',
      result: '"enter"→"hot", "your"→"oh" etc. — no engine near-miss → _notAttempted: true, excluded from accuracy'
    },
    uiClass: 'word-bucket-not-attempted',
    note: 'Only affects trailing words (backward walk from end). Mid-passage errors are never marked. Requires positive evidence: at least one non-near-miss substitution in the tail before omissions are included.'
  },

  pkTrustOverride: {
    description: 'Disagreed substitution where Parakeet heard the correct word — forgiven by default (Trust Pk is ON by default). With Trust Pk ON, Parakeet is the PRIMARY correctness engine: it overrides Reverb on every disagreed word. Reverb\'s role becomes disfluency detection + initial transcript.',
    detector: 'app.js → Phase 7b: Parakeet trust override (after function word forgiveness, before post-struggle leniency)',
    countsAsError: false,
    config: {
      toggle: 'localStorage orf_trust_pk (UI toggle, ON by default)',
      requires_disagreed: true,
      requires_pk_correct: true
    },
    example: {
      reference: 'wounded',
      spoken: 'Reverb: "wound", Parakeet: "wounded"',
      result: 'Disagreed + Pk heard correct → forgiven (Trust Pk ON by default)'
    },
    guards: [
      'Trust Pk toggle must be ON (localStorage orf_trust_pk, defaults to "true")',
      'Entry must be type === "substitution"',
      'crossValidation must be "disagreed" (V1 and Pk disagree)',
      '_pkType must be "correct" (Parakeet heard the reference word)',
      'Not already forgiven by another mechanism',
      'FRAGMENT GUARD: No Pk insertion fragments at this ref boundary that are near-misses of the ref word (isNearMiss). If Pk produced fragments like "pro" alongside correct "pronounced", its RNNT decoder likely reconstructed the word from a struggled attempt — skip override.'
    ],
    uiClass: 'word-forgiven',
    note: 'ON by default. Can be toggled OFF to compare accuracy with standard ORF scoring (DIBELS/AIMSweb count dropped suffixes as errors). Fragment guard (added 2026-02-18): checks pkInsGroups[refIdx] and pkInsGroups[refIdx+1] for Pk insertions that are near-misses of the ref word. Blocked overrides logged in pk_trust_override stage with reason "pk_fragment_evidence".'
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

  // Reverb disfluencies (V1 keyword matching in app.js)
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
 * - insertion: Extra word (single/dual-engine — per ORF standards)
 * - confirmed_insertion: Extra word confirmed by all engines (tracked/displayed, not scored per ORF)
 * - longPause: 3+ second gap (visual indicator only)
 * - hesitation: Brief pause (< 3s)
 * - postStruggleLeniency: Parakeet correct after preceding error — Reverb off-track (one word leniency)
 * - properNounForgiveness: Close attempt at name
 * - inflectionalForgiveness: Base word correct, suffix differs ("school" for "schools")
 * - reverb_filler: Filler word (um, uh) via FILLER_WORDS set
 * - abbreviationCompoundMerge: i.e./e.g./U.S. read letter-by-letter → compound merged
 * - abbreviationExpansionMerge: i.e. read as "that is" → expansion merged
 * - numberExpansionMerge: "2014" read as "twenty fourteen" → expansion merged
 * - xvalAbbreviationConfirmation: Cross-validator confirms abbreviation reading
 * - preAlignmentFragmentMerge: Reverb BPE fragments merged before alignment ("i"+"d" → "id")
 * - tier1NearMatchOverride: Tier 1 fuzzy match uses xval word for 1-char diffs ("format"→"formats")
 * - spilloverConsolidation: Struggle fragments reassigned from wrong ref slots back to anchor word
 * - oovOmissionRecovery: OOV omission forgiven when <unknown> CTC tokens exist in time window
 * - oovPhoneticForgiveness: Foreign/rare OOV words forgiven via phonetic-normalized Levenshtein (≥60%)
 * - selfCorrection: False start or repetition before correct word — SC badge (informational)
 * - endOfReadingDetection: Trailing words where no engine heard anything near-miss — post-reading speech
 *
 * INFRASTRUCTURE FIXES:
 * - sttLookup keys use raw normalized words (not getCanonical) to match alignment hyp values
 * - Debug logger reads version from #version div (not hardcoded constant)
 */
