// maze-generator.js — Maze comprehension game: sentence extraction, word selection, distractor generation
// Pure logic module — no UI, no side effects.

import { levenshteinRatio } from './nl-api.js';

// ── Constants ──

const SIGHT_WORDS = new Set([
  'the','of','and','a','to','in','is','you','that','it','he','was','for','on','are',
  'as','with','his','they','i','at','be','this','have','from','or','one','had','by',
  'but','not','what','all','were','we','when','your','can','said','there','each',
  'which','she','do','how','their','if','will','up','other','about','out','many',
  'then','them','these','so','some','her','would','make','like','him','into','time',
  'has','look','two','more','write','go','see','number','no','way','could','people',
  'my','than','first','water','been','call','who','oil','its','now','find','long',
  'down','day','did','get','come','made','may','part','over','new','after','also',
  'back','use','an','just','know','take','came','work','three','word','must','because',
  'does','still','well','should','here','big','high','every','near','add','food',
  'between','own','below','country','last','school','father','keep','tree','never',
  'start','city','earth','eye','light','thought','head','under','story','saw','far',
  'left','few','while','along','might','close','something','seem','next','hard',
  'open','example','begin','life','always','those','both','paper','together','got',
  'group','often','run','important','until','children','side','feet','car','mile',
  'night','walk','white','sea','began','grow','took','river','four','carry','state',
  'once','book','hear','stop','without','second','late','miss','idea','enough','eat',
  'face','watch','far','really','almost','let','above','girl','sometimes','mountain',
  'cut','young','talk','soon','list','song','being','leave','family','am','old',
  'red','blue','green','little','yes','good','any','help','tell','boy','house',
  'give','very','much','before','right','too','mean','same','where','think','say',
  'great','small','end','put','hand','large','spell','air','away','animal','again',
  'play','why','went','read','need','land','different','home','us','move','try',
  'kind','off','turn','round','man','want','show','form','set','change','point',
  'such','place','only','through','much','line','just','name','say','great','where',
  'most','than'
]);

const FUNCTION_WORDS = new Set([
  'a','an','the',
  'i','me','my','mine','myself','you','your','yours','yourself',
  'he','him','his','himself','she','her','hers','herself',
  'it','its','itself','we','us','our','ours','ourselves',
  'they','them','their','theirs','themselves',
  'this','that','these','those','who','whom','whose','which','what',
  'in','on','at','to','for','with','by','from','of','about',
  'into','through','during','before','after','above','below',
  'between','under','over','up','down','out','off','near','around',
  'and','but','or','nor','for','yet','so','because','although',
  'while','if','when','since','until','unless','though','whereas',
  'is','am','are','was','were','be','been','being',
  'has','have','had','do','does','did',
  'will','would','shall','should','may','might','can','could','must',
  'not','no','very','too','also','just','only','than','then',
  'as','so','such'
]);

const HOMOPHONE_GROUPS = [
  ['their', 'there', "they're"],
  ['to', 'too', 'two'],
  ['your', "you're"],
  ['its', "it's"],
  ['hear', 'here'],
  ['write', 'right'],
  ['no', 'know'],
  ['new', 'knew'],
  ['one', 'won'],
  ['see', 'sea'],
  ['would', 'wood'],
  ['flower', 'flour'],
  ['bear', 'bare'],
  ['peace', 'piece'],
  ['wear', 'where'],
  ['son', 'sun'],
  ['rode', 'road'],
  ['tale', 'tail'],
  ['meet', 'meat'],
  ['break', 'brake']
];

const BUILTIN_DISTRACTORS = {
  NOUN: ['banana', 'mountain', 'pocket', 'blanket', 'garden', 'window', 'basket', 'dragon', 'pillow', 'forest'],
  VERB: ['whispered', 'crawled', 'bounced', 'melted', 'folded', 'twisted', 'scattered', 'wobbled', 'tumbled', 'drifted'],
  ADJ:  ['purple', 'fuzzy', 'enormous', 'tiny', 'wooden', 'golden', 'crooked', 'slippery', 'hollow', 'dusty'],
  ADV:  ['slowly', 'loudly', 'carefully', 'silently', 'gently', 'suddenly', 'bravely', 'eagerly', 'calmly', 'fiercely'],
  DEFAULT: ['banana', 'purple', 'whispered', 'slowly', 'garden', 'enormous', 'crawled', 'carefully']
};

const DIFFICULTY_PROFILES = {
  easy: {
    preferRepeatedWords: true,
    allowAdverbs: false,
    minWordLength: 3,
    maxWordLength: 7,
    positionPreference: 'mid',
    sightWordBonus: 3,
    distractorSource: 'different_pos',
  },
  standard: {
    preferRepeatedWords: false,
    allowAdverbs: false,
    minWordLength: 3,
    maxWordLength: 10,
    positionPreference: 'any',
    sightWordBonus: 1,
    distractorSource: 'mixed',
  },
  challenge: {
    preferRepeatedWords: false,
    allowAdverbs: true,
    minWordLength: 4,
    maxWordLength: 15,
    positionPreference: 'any',
    sightWordBonus: -1,
    distractorSource: 'same_pos',
  }
};

const ABBREVIATIONS = [
  'Mr', 'Mrs', 'Ms', 'Dr', 'Jr', 'Sr', 'St', 'Ave', 'Blvd',
  'Prof', 'Gen', 'Gov', 'Sgt', 'Cpl', 'Pvt', 'Lt', 'Capt',
  'Col', 'Maj', 'Rev', 'Vol', 'Dept', 'Est', 'Fig', 'vs'
];


// ── Utility functions ──

function cleanWord(w) {
  return w.replace(/^[^\w'-]+|[^\w'-]+$/g, '').toLowerCase();
}

function areHomophones(wordA, wordB) {
  const a = wordA.toLowerCase(), b = wordB.toLowerCase();
  if (a === b) return true;
  for (const group of HOMOPHONE_GROUPS) {
    if (group.includes(a) && group.includes(b)) return true;
  }
  return false;
}

function seededRandom(seed) {
  // Simple mulberry32 PRNG
  let t = seed | 0;
  return function() {
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function seededShuffle(array, seed) {
  const arr = [...array];
  const rng = seededRandom(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function getWordPOS(word, sentIdx, nlAnnotations) {
  if (!nlAnnotations || !Array.isArray(nlAnnotations)) return null;
  const lower = word.toLowerCase();
  for (const ann of nlAnnotations) {
    if (ann.word && ann.word.toLowerCase() === lower && ann.pos) {
      return ann.pos;
    }
  }
  return null;
}

function getWordTier(word, nlAnnotations) {
  if (!nlAnnotations || !Array.isArray(nlAnnotations)) return null;
  const lower = word.toLowerCase();
  for (const ann of nlAnnotations) {
    if (ann.word && ann.word.toLowerCase() === lower) return ann.tier || null;
  }
  return null;
}

function isProperNoun(word, nlAnnotations) {
  if (!nlAnnotations || !Array.isArray(nlAnnotations)) {
    // Heuristic: mid-sentence capitalized word
    return false; // caller checks capitalization separately
  }
  const lower = word.toLowerCase();
  for (const ann of nlAnnotations) {
    if (ann.word && ann.word.toLowerCase() === lower) return ann.isProperNoun === true;
  }
  return false;
}

function countWordInPassage(word, passageText) {
  const lower = word.toLowerCase();
  const words = passageText.toLowerCase().split(/\s+/);
  return words.filter(w => cleanWord(w) === lower).length;
}


// ── Sentence / clause extraction ──

function splitIntoSentences(passageText) {
  let text = passageText;

  // 1. Protect abbreviation periods
  for (const abbr of ABBREVIATIONS) {
    text = text.replace(new RegExp(`\\b${abbr}\\.`, 'g'), `${abbr}\u00A7`);
  }

  // 2. Protect decimal numbers (3.5 → 3§5)
  text = text.replace(/(\d)\.(\d)/g, '$1\u00A7$2');

  // 3. Protect ellipses (... → single character)
  text = text.replace(/\.{3}/g, '\u2026');

  // 4. Split on sentence-ending punctuation followed by whitespace + uppercase or quote
  const raw = text.split(/(?<=[.!?])\s+(?=[A-Z"\u201C]|$)/);

  // 5. Restore placeholders and filter (min 4 words)
  const sentences = raw
    .map(s => s.replace(/\u00A7/g, '.').replace(/\u2026/g, '...').trim())
    .filter(s => s.length > 0 && s.split(/\s+/).length >= 4);

  // 6. Fallback: if < 3 sentences, try clause-level splitting on commas/semicolons/colons
  //    This handles passages that are one long sentence (common in OCR-trimmed text)
  if (sentences.length < 3) {
    const clauses = splitIntoClauses(passageText);
    if (clauses.length > sentences.length) return clauses;
  }

  return sentences;
}

/**
 * Split text into clauses using commas, semicolons, colons, and dashes.
 * Used as a fallback when sentence-level splitting yields < 3 segments.
 */
function splitIntoClauses(passageText) {
  // Split on clause boundaries: , ; : —
  // Keep the delimiter with the preceding clause for natural reading
  const raw = passageText.split(/,\s+|;\s+|:\s+|\s+—\s+|\s+-\s+/);

  return raw
    .map(c => c.trim())
    .filter(c => {
      if (c.length === 0) return false;
      const words = c.split(/\s+/);
      // Clauses need at least 4 words to provide enough context
      return words.length >= 4;
    });
}


// ── Sentence scoring & selection ──

function scoreSentence(sentence, sentIdx, totalSentences, nlAnnotations) {
  const words = sentence.split(/\s+/);
  let score = 0;

  // Word count scoring
  if (words.length >= 5 && words.length <= 15) score += 2;
  else if (words.length === 4) score += 1;
  else if (words.length < 4) score -= 10;

  // Count content words
  let contentWords = 0;
  for (const w of words) {
    const clean = cleanWord(w);
    if (clean.length >= 3 && !FUNCTION_WORDS.has(clean)) contentWords++;
  }
  if (contentWords >= 2) score += 2;

  // Not the first sentence bonus
  if (sentIdx > 0) score += 1;

  return score;
}

function selectWithSpread(scoredSentences, targetCount) {
  const n = scoredSentences.length;
  if (n <= targetCount) return scoredSentences.map((s, i) => i);

  const zoneSize = Math.ceil(n / targetCount);
  const selected = [];

  for (let z = 0; z < targetCount; z++) {
    const start = z * zoneSize;
    const end = Math.min(start + zoneSize, n);
    const zone = scoredSentences.slice(start, end);

    if (zone.length > 0) {
      // Pick highest-scoring sentence in this zone
      let best = 0;
      for (let i = 1; i < zone.length; i++) {
        if (zone[i].score > zone[best].score) best = i;
      }
      selected.push(start + best);
    }
  }

  // If a zone was empty, steal from zone with most options
  while (selected.length < targetCount && selected.length < n) {
    // Find an unused sentence with the highest score
    let bestIdx = -1, bestScore = -Infinity;
    for (let i = 0; i < n; i++) {
      if (!selected.includes(i) && scoredSentences[i].score > bestScore) {
        bestScore = scoredSentences[i].score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) selected.push(bestIdx);
    else break;
  }

  return selected.sort((a, b) => a - b);
}


// ── Target word selection ──

function isEligibleTarget(word, wordIdx, sentenceWords, nlAnnotations, sentIdx, profile) {
  const clean = cleanWord(word);
  if (clean.length < profile.minWordLength || clean.length > profile.maxWordLength) return false;
  if (FUNCTION_WORDS.has(clean)) return false;
  if (/^\d+$/.test(clean)) return false;
  if (/'\w/.test(clean)) return false; // contractions

  if (nlAnnotations) {
    const pos = getWordPOS(clean, sentIdx, nlAnnotations);
    const tier = getWordTier(clean, nlAnnotations);
    if (tier === 'proper') return false;
    if (tier === 'function') return false;
    if (pos === 'NUM') return false;
    if (pos && !['NOUN', 'VERB', 'ADJ', 'ADV'].includes(pos)) return false;
    if (pos === 'ADV' && !profile.allowAdverbs) return false;
  } else {
    // Heuristic: mid-sentence capitalized → likely proper noun
    if (wordIdx > 0 && /^[A-Z]/.test(word) && clean.length >= 2) return false;
  }

  if (profile.positionPreference === 'mid' && (wordIdx === 0 || wordIdx === sentenceWords.length - 1)) return false;

  return true;
}

function scoreCandidate(word, wordIdx, sentenceWords, passageText, nlAnnotations, sentIdx, profile) {
  const clean = cleanWord(word);
  let score = 0;

  // Inferrability: word appears elsewhere in passage
  if (countWordInPassage(clean, passageText) >= 2) score += 3;

  // Position scoring
  const isFirst = wordIdx === 0;
  const isLast = wordIdx === sentenceWords.length - 1;
  if (!isFirst && !isLast) score += 2;
  else if (isLast) score += 1;
  else if (isFirst) score -= 2;

  // Word properties
  if (clean.length >= 4 && clean.length <= 8) score += 1;
  if (SIGHT_WORDS.has(clean)) score += profile.sightWordBonus;
  else if (clean.length > 6) score -= 1;

  // POS bonus (with NL API)
  if (nlAnnotations) {
    const pos = getWordPOS(clean, sentIdx, nlAnnotations);
    if (pos === 'NOUN') score += 2;
    else if (pos === 'VERB') score += 1;
    else if (pos === 'ADJ') score += 1;
  }

  // Easy mode: prefer repeated words
  if (profile.preferRepeatedWords && countWordInPassage(clean, passageText) < 2) score -= 2;

  return score;
}

function selectTargetWord(sentence, sentIdx, passageText, nlAnnotations, profile) {
  const words = sentence.split(/\s+/);
  let bestWord = null, bestScore = -Infinity, bestIdx = -1;

  for (let i = 0; i < words.length; i++) {
    if (!isEligibleTarget(words[i], i, words, nlAnnotations, sentIdx, profile)) continue;
    const score = scoreCandidate(words[i], i, words, passageText, nlAnnotations, sentIdx, profile);
    // Tie-break: prefer closer to sentence center
    const centerDist = Math.abs(i - words.length / 2);
    const tieBreaker = -centerDist * 0.01;
    if (score + tieBreaker > bestScore + (bestWord ? 0 : 0)) {
      if (score > bestScore || (score === bestScore && centerDist < Math.abs(bestIdx - words.length / 2))) {
        bestScore = score;
        bestWord = words[i];
        bestIdx = i;
      }
    }
  }

  return bestWord ? { word: bestWord, index: bestIdx, score: bestScore } : null;
}


// ── Distractor generation ──

function pickFromBuiltinPool(pos, excludeWord) {
  const pool = BUILTIN_DISTRACTORS[pos] || BUILTIN_DISTRACTORS.DEFAULT;
  const filtered = pool.filter(w => w.toLowerCase() !== excludeWord.toLowerCase());
  return pickRandom(filtered) || pool[0];
}

function generateDistractors(targetWord, targetSentIdx, sentences, nlAnnotations, profile) {
  const target = cleanWord(targetWord);
  const targetPOS = getWordPOS(target, targetSentIdx, nlAnnotations);

  // Collect all content words from OTHER sentences
  const pool = [];
  for (let i = 0; i < sentences.length; i++) {
    if (i === targetSentIdx) continue;
    const words = sentences[i].split(/\s+/);
    for (const w of words) {
      const clean = cleanWord(w);
      if (clean.length < 3) continue;
      if (FUNCTION_WORDS.has(clean)) continue;
      if (clean === target) continue;
      if (/^\d+$/.test(clean)) continue;
      if (/'\w/.test(clean)) continue;
      // Deduplicate
      if (pool.some(p => p.word === clean)) continue;
      pool.push({ word: clean, display: w, sentIdx: i, pos: getWordPOS(clean, i, nlAnnotations) });
    }
  }

  // Apply quality guards
  function isValidDistractor(candidate) {
    if (areHomophones(candidate, target)) return false;
    if (levenshteinRatio(candidate, target) >= 0.7) return false;
    return true;
  }

  const validPool = pool.filter(p => isValidDistractor(p.word));

  let distractorA = null, distractorB = null;

  if (profile.distractorSource === 'same_pos') {
    // Challenge: both same POS
    const samePOS = targetPOS ? validPool.filter(w => w.pos === targetPOS) : validPool;
    distractorA = pickRandom(samePOS) || pickRandom(validPool);
    const remainingSame = samePOS.filter(w => w.word !== distractorA?.word);
    distractorB = pickRandom(remainingSame) || pickRandom(validPool.filter(w => w.word !== distractorA?.word));
  } else if (profile.distractorSource === 'different_pos') {
    // Easy: both different POS
    const diffPOS = targetPOS ? validPool.filter(w => w.pos && w.pos !== targetPOS) : validPool;
    distractorA = pickRandom(diffPOS) || pickRandom(validPool);
    const remainingDiff = diffPOS.filter(w => w.word !== distractorA?.word);
    distractorB = pickRandom(remainingDiff) || pickRandom(validPool.filter(w => w.word !== distractorA?.word));
  } else {
    // Standard: one same POS, one different POS
    if (targetPOS) {
      const samePOS = validPool.filter(w => w.pos === targetPOS);
      distractorA = pickRandom(samePOS) || pickRandom(validPool);
    } else {
      distractorA = pickRandom(validPool);
    }
    const remaining = validPool.filter(w => w.word !== distractorA?.word);
    if (targetPOS) {
      const diffPOS = remaining.filter(w => w.pos !== targetPOS);
      distractorB = pickRandom(diffPOS) || pickRandom(remaining);
    } else {
      distractorB = pickRandom(remaining);
    }
  }

  // Ensure no duplicates between distractors
  if (distractorA && distractorB && distractorA.word === distractorB.word) {
    const other = validPool.filter(w => w.word !== distractorA.word && w.word !== target);
    distractorB = pickRandom(other);
  }

  // Fallback to builtin pool
  if (!distractorA) distractorA = { word: pickFromBuiltinPool(targetPOS, target) };
  if (!distractorB) distractorB = { word: pickFromBuiltinPool(targetPOS === 'NOUN' ? 'VERB' : 'NOUN', target) };

  // Final guard: no duplicates
  if (distractorA.word === distractorB.word) {
    distractorB = { word: pickFromBuiltinPool('DEFAULT', distractorA.word) };
  }

  return [distractorA.word, distractorB.word];
}


// ── Main API ──

/**
 * Check if passage has enough content for a maze game.
 * Requires 15+ words. Accepts 3+ sentences OR 3+ clauses.
 * With fewer segments, allows 1-2 rounds.
 */
export function canRunMaze(passageText) {
  if (!passageText) return false;
  const words = passageText.trim().split(/\s+/);
  if (words.length < 15) return false;
  // splitIntoSentences already includes clause fallback
  const segments = splitIntoSentences(passageText);
  return segments.length >= 1;
}

/**
 * Generate maze items from a passage.
 * @param {string} passageText - The full passage text
 * @param {Array|null} nlAnnotations - NL API annotations (per-word POS, tier, etc.) or null
 * @param {string} difficulty - 'easy' | 'standard' | 'challenge'
 * @param {string} [seed] - Optional seed for deterministic shuffling (e.g. assessment ID)
 * @returns {Array} Array of maze items (scales with passage size)
 */
export function generateMazeItems(passageText, nlAnnotations, difficulty, seed) {
  const profile = DIFFICULTY_PROFILES[difficulty] || DIFFICULTY_PROFILES.standard;
  const sentences = splitIntoSentences(passageText);

  if (sentences.length === 0) return [];

  // Score all sentences
  const scored = sentences.map((sent, i) => ({
    sentence: sent,
    index: i,
    score: scoreSentence(sent, i, sentences.length, nlAnnotations)
  }));

  // Scale challenge count with passage size
  const targetCount = sentences.length <= 4 ? Math.min(3, sentences.length)
    : sentences.length <= 8 ? Math.min(5, sentences.length)
    : Math.min(8, sentences.length);

  // Select more candidates than needed — fallback pool for sentences
  // that fail target word selection or produce duplicate targets
  const candidateCount = Math.min(sentences.length, targetCount * 2);
  const candidateIndices = selectWithSpread(scored, candidateCount);

  const seedNum = seed ? hashString(seed) : Date.now();
  const items = [];
  const usedTargets = new Set();

  for (const idx of candidateIndices) {
    if (items.length >= targetCount) break;

    const sent = sentences[idx];
    const target = selectTargetWord(sent, idx, passageText, nlAnnotations, profile);
    if (!target) continue;

    const cleanTarget = cleanWord(target.word);
    if (usedTargets.has(cleanTarget)) continue;
    usedTargets.add(cleanTarget);

    const [d1, d2] = generateDistractors(target.word, idx, sentences, nlAnnotations, profile);

    // Build blank sentence
    const words = sent.split(/\s+/);
    const blankWords = [...words];
    blankWords[target.index] = '________';
    const blankSentence = blankWords.join(' ');

    // Shuffle options deterministically
    const options = [cleanTarget, d1, d2];
    const itemSeed = seedNum + items.length * 7919; // Different seed per item
    const shuffledOptions = seededShuffle(options, itemSeed);
    const correctShuffledIndex = shuffledOptions.indexOf(cleanTarget);

    // Build surrounding context (previous + next segments, dimmed in UI)
    const contextBefore = idx > 0 ? sentences[idx - 1] : '';
    const contextAfter = idx < sentences.length - 1 ? sentences[idx + 1] : '';

    items.push({
      sentence: sent,
      blankSentence,
      contextBefore,
      contextAfter,
      targetWord: cleanTarget,
      targetIndex: target.index,
      sentenceIndex: idx,
      score: target.score,
      options,
      shuffledOptions,
      correctShuffledIndex
    });
  }

  return items;
}

/**
 * Verify a spoken response against maze options.
 * @param {string} spokenTranscript - Raw ASR transcript
 * @param {Array} options - The 3 displayed options
 * @param {string} correctWord - The correct answer
 * @returns {{ matched: string|null, correct: boolean, matchType: string }}
 */
export function verifyMazeResponse(spokenTranscript, options, correctWord) {
  if (!spokenTranscript || !options || !correctWord) {
    return { matched: null, correct: false, matchType: 'none' };
  }

  const matched = matchSpokenWordToOptions(spokenTranscript, options);
  if (!matched) return { matched: null, correct: false, matchType: 'none' };

  const correct = matched.toLowerCase() === correctWord.toLowerCase();
  // Determine match type
  const words = spokenTranscript.toLowerCase().trim().split(/\s+/);
  let matchType = 'near';
  for (const w of words) {
    if (w === matched.toLowerCase()) { matchType = 'exact'; break; }
    if (areHomophones(w, matched)) { matchType = 'homophone'; break; }
  }

  return { matched, correct, matchType };
}

/**
 * Match spoken transcript to one of the maze options (best-score wins).
 */
function matchSpokenWordToOptions(transcript, options) {
  const words = transcript.toLowerCase().trim().split(/\s+/);
  let bestMatch = null;
  let bestScore = 0;

  for (const option of options) {
    const optNorm = option.toLowerCase();

    for (const word of words) {
      let score = 0;

      if (word === optNorm) {
        score = 1.0;
      } else if (areHomophones(word, optNorm)) {
        score = 0.90;
      } else {
        const ratio = levenshteinRatio(word, optNorm);
        if (ratio >= 0.75 && word.length >= 3) {
          score = ratio * 0.85;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = option;
      }
    }
  }

  return bestScore >= 0.60 ? bestMatch : null;
}
