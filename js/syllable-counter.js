// syllable-counter.js — Dependency-free English syllable counter
//
// Heuristic algorithm for estimating syllable counts in English words.
// Originally the primary normalizer for spoken word duration in ORF assessment;
// now serves as the fallback estimator for words not found in CMUdict.
//
// The primary normalizer is now phoneme count (from CMUdict via phoneme-counter.js).
// Phoneme count captures consonant density that syllable count misses — e.g.,
// "spreadsheet" (2 syl, 8 phonemes) vs "baby" (2 syl, 4 phonemes). For words
// not in CMUdict, we estimate: phonemes ≈ syllables × PHONEMES_PER_SYLLABLE_RATIO.
// See docs/phoneme-normalization-plan.md for full rationale.
//
// Algorithm lineage: Based on the approach from Lingua::EN::Syllable (Perl),
// adapted through Text-Statistics (PHP) and the words/syllable (JS) ecosystem,
// with additional rules from sylco (Python) and custom tuning for grade 1-8
// reading vocabulary.
//
// Accuracy: ~95% on grade 1-8 reading vocabulary. Perfect accuracy is
// impossible without a full pronunciation dictionary (CMU Dict = 134K words)
// because English orthography is not phonetically regular.

// ── Exception dictionary ────────────────────────────────────────────────
// Words whose syllable counts are notoriously wrong under heuristic rules.
// This covers the most common problematic words at grade 1-8 reading levels.

const EXCEPTIONS = {
  // Silent-e words that trip up the algorithm
  'simile': 3,
  'recipe': 3,
  'epitome': 4,
  'hyperbole': 4,
  'apostrophe': 4,
  'catastrophe': 4,
  'anemone': 4,
  'calliope': 4,

  // -ed endings that are pronounced as separate syllables
  'aged': 2,
  'blessed': 2,
  'crooked': 2,
  'dogged': 2,
  'learned': 2,
  'naked': 2,
  'ragged': 2,
  'rugged': 2,
  'sacred': 2,
  'wicked': 2,
  'wretched': 2,

  // Short words where silent-e rule can't fire (length <= 3)
  'ice': 1,
  'ace': 1,
  'age': 1,
  'ape': 1,
  'ate': 1,
  'awe': 1,
  'axe': 1,
  'aye': 1,
  'dye': 1,
  'eye': 1,
  'ire': 1,
  'ode': 1,
  'one': 1,
  'ore': 1,
  'owe': 1,
  'rye': 1,
  'use': 1,

  // Common words with unusual vowel patterns
  'experience': 4,
  'area': 3,
  'idea': 3,
  'real': 1,
  'deal': 1,
  'seal': 1,
  'meal': 1,
  'oil': 1,
  'soil': 1,
  'coil': 1,
  'poem': 2,
  'poet': 2,
  'lion': 2,
  'quiet': 2,
  'quite': 1,
  'science': 2,
  'being': 2,
  'seeing': 2,
  'going': 2,
  'doing': 2,
  'every': 3,
  'different': 3,
  'family': 3,
  'favorite': 3,
  'evening': 3,
  'several': 3,
  'interest': 3,
  'chocolate': 3,
  'comfortable': 4,
  'vegetable': 4,
  'beautiful': 3,
  'business': 3,
  'camera': 3,
  'general': 3,
  'usually': 4,
  'actually': 4,
  'finally': 3,
  'animal': 3,
  'library': 3,
  'opening': 3,
  'diamond': 3,
  'violet': 3,
  'pioneer': 3,

  // Tricky single-syllable words
  'fire': 1,
  'hire': 1,
  'tire': 1,
  'wire': 1,
  'cure': 1,
  'pure': 1,
  'sure': 1,
  'were': 1,
  'where': 1,
  'there': 1,
  'here': 1,
  'gone': 1,
  'done': 1,
  'none': 1,
  'come': 1,
  'some': 1,
  'love': 1,
  'move': 1,
  'give': 1,
  'live': 1,
  'have': 1,
  'clothes': 1,
  'league': 1,
  'tongue': 1,
  'plague': 1,
  'vague': 1,
  'rogue': 1,
  'breathe': 1,
  'soothe': 1,
  'loathe': 1,
  'bathe': 1,
  'lathe': 1,
  'scathe': 1,
  'clothe': 1,
  'whole': 1,
  'whose': 1,
  'once': 1,
  'since': 1,
  'prince': 1,
  'hence': 1,
  'fence': 1,
  'sense': 1,
  'dense': 1,
  'tense': 1,
  'rinse': 1,
  'moose': 1,
  'goose': 1,
  'loose': 1,
  'choose': 1,
  'cheese': 1,
  'breeze': 1,
  'freeze': 1,
  'squeeze': 1,
  'sneeze': 1,
  'geese': 1,
  'these': 1,
  'twelve': 1,
  'nerve': 1,
  'serve': 1,
  'curve': 1,
  'nurse': 1,
  'purse': 1,
  'horse': 1,
  'course': 1,
  'source': 1,
  'force': 1,
  'large': 1,
  'charge': 1,
  'strange': 1,
  'change': 1,
  'range': 1,
  'bridge': 1,
  'ridge': 1,
  'edge': 1,
  'ledge': 1,
  'judge': 1,
  'fudge': 1,
  'badge': 1,
  'lodge': 1,
  'knowledge': 2,
  'college': 2,
  'village': 2,
  'cabbage': 2,
  'garbage': 2,
  'storage': 2,
  'average': 3,
  'coverage': 3,
  'leverage': 3,

  // -ire words
  'entire': 3,
  'desire': 3,
  'admire': 3,
  'inspire': 3,
  'require': 3,
  'retire': 3,
  'vampire': 3,
  'empire': 3,
  'campfire': 2,
  'bonfire': 2,
  'gunfire': 2,
  'crossfire': 2,
  'hellfire': 2,
  'wildfire': 2,
  'spitfire': 2,

  // Tricky two-syllable words
  'people': 2,
  'little': 2,
  'middle': 2,
  'trouble': 2,
  'double': 2,
  'couple': 2,
  'purple': 2,
  'simple': 2,
  'single': 2,
  'gentle': 2,
  'candle': 2,
  'handle': 2,
  'castle': 2,
  'muscle': 2,
  'hustle': 2,
  'wrestle': 2,
  'whistle': 2,
  'bottle': 2,
  'rattle': 2,
  'battle': 2,
  'cattle': 2,
  'saddle': 2,
  'paddle': 2,
  'puddle': 2,
  'riddle': 2,
  'fiddle': 2,
  'giggle': 2,
  'wiggle': 2,
  'struggle': 2,
  'jungle': 2,
  'humble': 2,
  'tumble': 2,
  'stumble': 2,
  'crumble': 2,
  'rumble': 2,
  'fumble': 2,
  'grumble': 2,
  'mumble': 2,
  'nimble': 2,
  'thimble': 2,
  'tremble': 2,
  'resemble': 3,
  'assemble': 3,
  'ensemble': 3,
  'preamble': 3,

  // -ous words
  'serious': 3,
  'curious': 3,
  'furious': 3,
  'previous': 3,
  'obvious': 3,
  'various': 3,
  'enormous': 3,
  'dangerous': 3,
  'mysterious': 4,
  'continuous': 4,

  // Compound words with mid-word silent-e (not hyphenated)
  'something': 2,
  'someone': 2,
  'somewhere': 2,
  'sometime': 2,
  'sometimes': 2,
  'somehow': 2,
  'somewhat': 2,
  'somebody': 3,
  'someday': 2,
  'someplace': 2,
  'homesick': 2,
  'homeless': 2,
  'homework': 2,
  'lonesome': 2,
  'handsome': 2,
  'wholesome': 2,
  'awesome': 2,
  'tiresome': 2,
  'therefore': 2,
  'furthermore': 3,
  'elsewhere': 2,
  'whatever': 3,
  'whenever': 3,
  'wherever': 3,
  'whoever': 3,
  'however': 3,
  'moreover': 3,
  'horseback': 2,
  'horseshoe': 2,

  // -efully/-elessly words (mid-word silent-e + suffix)
  'carefully': 3,
  'carelessly': 3,
  'hopeful': 2,
  'hopefully': 3,
  'hopeless': 2,
  'hopelessly': 3,
  'peaceful': 2,
  'peacefully': 3,
  'graceful': 2,
  'gracefully': 3,
  'wasteful': 2,
  'wastefully': 3,
  'grateful': 2,
  'gratefully': 3,
  'hateful': 2,
  'tasteful': 2,
  'tastefully': 3,
  'nameless': 2,
  'homeless': 2,
  'boneless': 2,
  'faceless': 2,
  'timeless': 2,
  'wireless': 2,
  'tireless': 2,
  'tirelessly': 3,
  'useless': 2,
  'uselessly': 3,
  'lonely': 2,
  'lovely': 2,
  'lately': 2,
  'merely': 2,
  'rarely': 2,
  'purely': 2,
  'surely': 2,
  'entirely': 3,
  'sincerely': 3,
  'severely': 3,
  'extremely': 3,
  'completely': 3,
  'immediately': 5,
  'fortunately': 4,
  'unfortunately': 5,
  'separately': 4,
  'desperately': 4,
  'accurately': 4,
  'deliberately': 5,

  // Words where -ed is NOT a silent suffix
  'hundred': 2,
  'kindred': 2,
  'hatred': 2,

  // -vement/-ement words (mid-word silent-e)
  'movement': 2,
  'improvement': 3,
  'achievement': 3,
  'involvement': 3,
  'excitement': 3,
  'amazement': 3,
  'arrangement': 3,
  'engagement': 3,
  'management': 3,
  'replacement': 3,
  'requirement': 3,
  'retirement': 3,
  'settlement': 3,
  'statement': 2,
  'pavement': 2,
  'advertisement': 4,
  'announcement': 3,
  'enforcement': 3,
  'encouragement': 4,

  // -aying/-eying words (y between vowels breaks syllable)
  'playing': 2,
  'saying': 2,
  'staying': 2,
  'paying': 2,
  'praying': 2,
  'laying': 2,
  'spraying': 2,
  'swaying': 2,
  'delaying': 3,
  'displaying': 3,
  'obeying': 3,
  'surveying': 3,
  'conveying': 3,
  'portraying': 3,
  'decaying': 3,
  'relaying': 3,
  'replaying': 3,

  // Syllabic consonants (no standard vowel in one syllable)
  'rhythm': 2,
  'prism': 2,
  'chasm': 2,
  'spasm': 2,
  'sarcasm': 3,

  // -yle/-yre words (y is vowel before -le, silent-e should apply)
  'style': 1,
  'while': 1,
  'smile': 1,
  'file': 1,
  'pile': 1,
  'tile': 1,
  'mile': 1,
  'aisle': 1,
  'isle': 1,

  // Words where trailing -ue is pronounced (not silent)
  'continue': 3,
  'discontinue': 4,
  'revenue': 3,
  'avenue': 3,
  'residue': 3,
  'rescue': 2,
  'barbecue': 3,
  'virtue': 2,

  // -ture words (2 syllables each, not 1)
  'ature': 2,
  'creature': 2,
  'feature': 2,
  'nature': 2,
  'future': 2,
  'picture': 2,
  'capture': 2,
  'mixture': 2,
  'texture': 2,
  'culture': 2,
  'structure': 2,
  'fracture': 2,
  'lecture': 2,
  'gesture': 2,
  'moisture': 2,
  'pasture': 2,
  'posture': 2,
  'sculpture': 2,
  'venture': 2,
  'vulture': 2,
  'furniture': 3,
  'adventure': 3,
  'temperature': 4,
  'literature': 4,
  'architecture': 4,
  'agriculture': 4,
  'manufacture': 4,
  'signature': 3,
  'miniature': 4,
  'caricature': 4,

  // -tion/-sion words (algorithm usually handles these, but just in case)
  'education': 4,
  'information': 4,
  'imagination': 5,
  'communication': 5,
  'determination': 5,

  // Common contractions
  "i'm": 1,
  "i'll": 1,
  "i'd": 1,
  "i've": 1,
  "he's": 1,
  "she's": 1,
  "it's": 1,
  "we're": 1,
  "we've": 1,
  "we'll": 1,
  "we'd": 1,
  "you're": 1,
  "you've": 1,
  "you'll": 1,
  "you'd": 1,
  "they're": 1,
  "they've": 1,
  "they'll": 1,
  "they'd": 1,
  "that's": 1,
  "what's": 1,
  "who's": 1,
  "here's": 1,
  "there's": 1,
  "where's": 1,
  "let's": 1,
  "how's": 1,
  "isn't": 2,
  "aren't": 2,
  "wasn't": 2,
  "weren't": 2,
  "don't": 1,
  "doesn't": 2,
  "didn't": 2,
  "won't": 1,
  "wouldn't": 2,
  "shouldn't": 2,
  "couldn't": 2,
  "can't": 1,
  "hasn't": 2,
  "haven't": 2,
  "hadn't": 2,
  "mustn't": 2,
  "needn't": 2,
};

// ── Regex patterns ──────────────────────────────────────────────────────

// Vowel group splitter: consecutive vowels (including y in vowel positions)
const VOWEL_GROUP = /[aeiouy]+/gi;

// Patterns that ADD a syllable (undercounted by naive vowel-group counting)
const ADD_SYLLABLE_PATTERNS = [
  /(?<![ct])ia(?!n)/gi,  // "dia-" "via-" but not "-cial"/"-tial"/"-ian"
  /iet/gi,              // "quiet", "diet"
  /io(?!n)/gi,          // "bio-" "pio-" but not "-tion"/"-sion"
  /ii/gi,               // "radii"
  /iu/gi,               // "stadium", "calcium"
  /[aeiou]ing$/gi,      // "seeing", "doing", "going" — vowel + -ing
  /eo(?![u])/gi,        // "neon", "people" — but not "eous"
  /ua(?![lg])/gi,       // "actual", "manual" — but not "guard"/"equal"
  /ue[lt]/gi,           // "fuel", "cruel", "duet"
];

// Patterns that SUBTRACT a syllable (overcounted by naive vowel-group counting)
const SUB_SYLLABLE_PATTERNS = [
  /[aeiouy]ed$/gi,      // "played", "stayed" (vowel+ed = silent ed)
  /ely$/gi,             // "lonely", "lovely"
];

// ── Core algorithm ──────────────────────────────────────────────────────

/**
 * Count syllables in an English word.
 *
 * Algorithm:
 * 1. Check exception dictionary
 * 2. Count vowel groups (consecutive vowels including y)
 * 3. Apply suffix adjustments (-ed, -es, -le, -tion, etc.)
 * 4. Apply addition/subtraction patterns for dipthongs and special combos
 * 5. Clamp to minimum of 1
 *
 * @param {string} word - A single English word (may contain apostrophes/hyphens)
 * @returns {number} Estimated syllable count (minimum 1)
 */
export function countSyllables(word) {
  if (!word || typeof word !== 'string') return 1;

  // Normalize: lowercase, strip non-alpha except apostrophes and hyphens
  let w = word.toLowerCase().trim();
  w = w.replace(/[^a-z'-]/g, '');

  if (w.length === 0) return 1;

  // Handle hyphenated compounds by summing parts
  if (w.includes('-')) {
    const parts = w.split('-').filter(Boolean);
    if (parts.length > 1) {
      return parts.reduce((sum, part) => sum + countSyllables(part), 0);
    }
  }

  // Check exception dictionary first
  if (EXCEPTIONS[w] !== undefined) {
    return EXCEPTIONS[w];
  }

  // Strip possessive 's (doesn't add a syllable for most words)
  // Exception: words ending in s/z/x/sh/ch where 's adds a syllable
  // are rare as possessives in reading passages
  if (w.endsWith("'s")) {
    w = w.slice(0, -2);
  } else if (w.endsWith("'")) {
    w = w.slice(0, -1);
  }

  // Very short words: 1 syllable
  if (w.length <= 2) return 1;

  let count = 0;

  // Step 1: Count vowel groups
  const vowelGroups = w.match(VOWEL_GROUP);
  count = vowelGroups ? vowelGroups.length : 1;

  // Step 2: Silent-e at end of word
  // A trailing 'e' after a consonant is usually silent (makes previous vowel long)
  // Exception: consonant + le is its own syllable ("ap-ple", "lit-tle")
  // But vowel + le ("while", "smile", "male") = silent-e, not a separate syllable
  if (w.endsWith('e') && w.length > 3 && !w.endsWith('ee') && !w.endsWith('ye')) {
    if (w.endsWith('le') && w.length > 3) {
      const beforeLe = w[w.length - 3];
      if (/[aeiouy]/.test(beforeLe)) {
        // vowel + le = silent-e (e.g., "while", "male", "smile", "file")
        count--;
      }
      // consonant + le = separate syllable, no subtraction needed
      // (e.g., "apple", "candle", "simple" — already counted correctly)
    } else {
      // Regular silent-e: "make", "time", "home", etc.
      count--;
    }
  }

  // Step 4: -ed endings
  // "-ed" is usually silent after most consonants except t/d
  // "walked" = 1 syl, "jumped" = 1 syl, but "wanted" = 2, "landed" = 2
  if (w.endsWith('ed') && w.length > 3) {
    const beforeEd = w[w.length - 3];
    if (beforeEd !== 't' && beforeEd !== 'd') {
      // Silent -ed: the 'e' in 'ed' shouldn't count
      // Check if 'ed' was counted as a vowel group
      if (/[^aeiouy]ed$/.test(w)) {
        count--;
      }
    }
  }

  // Step 5: -es endings
  // "-es" is usually silent after most consonants except s/z/x/sh/ch
  // "makes" = 1 syl, but "buses" = 2, "boxes" = 2, "catches" = 2
  if (w.endsWith('es') && w.length > 3) {
    const beforeEs = w.slice(-4, -2);
    if (!/(?:ss|zz|sh|ch|[sxz])$/.test(w.slice(0, -2))) {
      // Silent -es (already counted as vowel group)
      if (/[^aeiouy]es$/.test(w)) {
        count--;
      }
    }
  }

  // Step 6: -tion, -sion = 1 syllable (not 2)
  // "na-tion" not "na-ti-on"
  // The vowel group counter sees "io" as one group, so usually correct.
  // But sometimes -tion is parsed with preceding vowel. No adjustment needed
  // if vowel grouping is working correctly.

  // Step 7: Apply addition patterns
  for (const pattern of ADD_SYLLABLE_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = w.match(pattern);
    if (matches) count += matches.length;
  }

  // Step 8: Apply subtraction patterns
  for (const pattern of SUB_SYLLABLE_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = w.match(pattern);
    if (matches) count -= matches.length;
  }

  // Step 9: Prefix adjustments
  // "mc-" prefix adds a syllable: "McDonald" = 3
  if (w.startsWith('mc')) count++;

  // "re-" before a vowel is often 2 syllables: "re-enter", "re-align"
  // But not always: "read", "real", "reach" — handled by vowel grouping naturally

  // Step 10: Y as first letter is a consonant, not a vowel
  // If word starts with 'y' + vowel, we may have overcounted
  if (w.startsWith('y') && w.length > 1 && /[aeiouy]/.test(w[1])) {
    // 'y' at start before another vowel: the vowel group "ya"/"ye"/etc.
    // is correctly 1 group, so no adjustment needed
  }

  // Clamp to minimum 1
  return Math.max(1, count);
}

/**
 * Count total syllables in a phrase or sentence.
 * Splits on whitespace and sums syllable counts.
 *
 * @param {string} text - Text containing one or more words
 * @returns {number} Total syllable count
 */
export function countSyllablesInText(text) {
  if (!text || typeof text !== 'string') return 0;
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.reduce((sum, word) => sum + countSyllables(word), 0);
}

/**
 * Calculate syllable rate (syllables per unit) for duration normalization.
 * Use this instead of character count when normalizing word durations.
 *
 * Example: "beautiful" = 3 syllables. If spoken in 600ms, that's 200ms/syllable.
 *          "cat" = 1 syllable. If spoken in 250ms, that's 250ms/syllable.
 *          By syllable rate, these are comparable. By character rate,
 *          "beautiful" (600/9 = 67ms/char) would appear much faster than
 *          "cat" (250/3 = 83ms/char), which is misleading.
 *
 * @param {string} word - The word
 * @param {number} durationMs - Duration in milliseconds
 * @returns {number} Milliseconds per syllable
 */
export function msPerSyllable(word, durationMs) {
  const syllables = countSyllables(word);
  return durationMs / syllables;
}
