/**
 * Word equivalence rules for oral reading fluency assessment.
 *
 * Maps written forms (as they appear in reference text) to acceptable
 * spoken pronunciations. When a student says an equivalent form, it
 * counts as correct — not a substitution.
 *
 * All entries are lowercase/normalized.
 */

const EQUIVALENCE_GROUPS = [
  // Abbreviations & symbols
  ['vs', 'versus', 'verses'],
  ['mr', 'mister'],
  ['mrs', 'missus', 'misses'],
  ['ms', 'miss', 'miz'],
  ['dr', 'doctor'],
  ['st', 'saint', 'street'],
  ['ave', 'avenue'],
  ['blvd', 'boulevard'],
  ['dept', 'department'],
  ['govt', 'government'],
  ['jr', 'junior'],
  ['sr', 'senior'],
  ['sgt', 'sergeant'],
  ['capt', 'captain'],
  ['lt', 'lieutenant'],
  ['gen', 'general'],
  ['prof', 'professor'],
  ['rev', 'reverend'],

  // Contractions ↔ expanded forms
  ["can't", 'cannot', 'can not'],
  ["won't", 'will not'],
  ["don't", 'do not'],
  ["doesn't", 'does not'],
  ["didn't", 'did not'],
  ["isn't", 'is not'],
  ["aren't", 'are not'],
  ["wasn't", 'was not'],
  ["weren't", 'were not'],
  ["hasn't", 'has not'],
  ["haven't", 'have not'],
  ["hadn't", 'had not'],
  ["wouldn't", 'would not'],
  ["couldn't", 'could not'],
  ["shouldn't", 'should not'],
  ["i'm", 'i am'],
  ["i'll", 'i will'],
  ["i've", 'i have'],
  ["i'd", 'i would', 'i had'],
  ["we're", 'we are'],
  ["we've", 'we have'],
  ["we'll", 'we will'],
  ["they're", 'they are'],
  ["they've", 'they have'],
  ["they'll", 'they will'],
  ["you're", 'you are'],
  ["you've", 'you have'],
  ["you'll", 'you will'],
  ["he's", 'he is', 'he has'],
  ["she's", 'she is', 'she has'],
  ["it's", 'it is', 'it has'],
  ["that's", 'that is', 'that has'],
  ["there's", 'there is', 'there has'],
  ["here's", 'here is', 'here has'],
  ["what's", 'what is', 'what has'],
  ["who's", 'who is', 'who has'],
  ["let's", 'let us'],

  // Numbers written as digits ↔ words
  ['1', 'one'],
  ['2', 'two'],
  ['3', 'three'],
  ['4', 'four'],
  ['5', 'five'],
  ['6', 'six'],
  ['7', 'seven'],
  ['8', 'eight'],
  ['9', 'nine'],
  ['10', 'ten'],
  ['11', 'eleven'],
  ['12', 'twelve'],
  ['13', 'thirteen'],
  ['14', 'fourteen'],
  ['15', 'fifteen'],
  ['16', 'sixteen'],
  ['17', 'seventeen'],
  ['18', 'eighteen'],
  ['19', 'nineteen'],
  ['20', 'twenty'],

  // Symbols that might appear in text
  ['&', 'and'],
  ['%', 'percent'],

  // Common alternate forms
  ['ok', 'okay'],
  ['gonna', 'going to'],
  ['wanna', 'want to'],
  ['gotta', 'got to'],
  ['kinda', 'kind of'],
  ['sorta', 'sort of'],
];

/**
 * Build a lookup: normalized word → canonical form.
 * Every word in a group maps to the first entry (canonical).
 */
const wordToCanonical = new Map();

for (const group of EQUIVALENCE_GROUPS) {
  const canonical = group[0];
  for (const word of group) {
    // If a word appears in multiple groups, first group wins
    if (!wordToCanonical.has(word)) {
      wordToCanonical.set(word, canonical);
    }
  }
}

/**
 * Return the canonical form of a word if an equivalence exists,
 * otherwise return the word unchanged.
 * @param {string} word  Normalized (lowercase, punctuation-stripped) word
 * @returns {string}
 */
export function getCanonical(word) {
  return wordToCanonical.get(word) || word;
}
