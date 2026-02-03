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
  ["we'd", 'we would', 'we had'],
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
 * Common homophones — words that sound the same but have different spellings/meanings.
 * Important for oral reading: student saying "there" when text says "their" is correct pronunciation.
 */
const HOMOPHONE_GROUPS = [
  ['their', 'there', "they're"],
  ['your', "you're"],
  ['its', "it's"],
  ['to', 'too', 'two'],
  ['by', 'bye', 'buy'],
  ['for', 'four', 'fore'],
  ['no', 'know'],
  ['new', 'knew', 'gnu'],
  ['right', 'write', 'rite'],
  ['see', 'sea'],
  ['be', 'bee'],
  ['hear', 'here'],
  ['our', 'hour'],
  ['ate', 'eight'],
  ['one', 'won'],
  ['sun', 'son'],
  ['would', 'wood'],
  ['which', 'witch'],
  ['wear', 'where', 'ware'],
  ['weather', 'whether'],
  ['piece', 'peace'],
  ['break', 'brake'],
  ['wait', 'weight'],
  ['great', 'grate'],
  ['whole', 'hole'],
  ['pair', 'pear', 'pare'],
  ['meet', 'meat'],
  ['read', 'red'],  // Past tense of read
  ['led', 'lead'],  // Metal
  ['bored', 'board'],
  ['flower', 'flour'],
  ['role', 'roll'],
  ['through', 'threw'],
  ['principal', 'principle'],
  ['stationary', 'stationery'],
  ['council', 'counsel'],
];

/**
 * Number words for 21-100 and ordinals 1st-20th.
 * Allows '21' to match 'twenty-one' and '1st' to match 'first'.
 */
const NUMBER_WORDS = [
  // 21-29
  ['21', 'twenty-one', 'twentyone'],
  ['22', 'twenty-two', 'twentytwo'],
  ['23', 'twenty-three', 'twentythree'],
  ['24', 'twenty-four', 'twentyfour'],
  ['25', 'twenty-five', 'twentyfive'],
  ['26', 'twenty-six', 'twentysix'],
  ['27', 'twenty-seven', 'twentyseven'],
  ['28', 'twenty-eight', 'twentyeight'],
  ['29', 'twenty-nine', 'twentynine'],
  // 30-39
  ['30', 'thirty'],
  ['31', 'thirty-one', 'thirtyone'],
  ['32', 'thirty-two', 'thirtytwo'],
  ['33', 'thirty-three', 'thirtythree'],
  ['34', 'thirty-four', 'thirtyfour'],
  ['35', 'thirty-five', 'thirtyfive'],
  ['36', 'thirty-six', 'thirtysix'],
  ['37', 'thirty-seven', 'thirtyseven'],
  ['38', 'thirty-eight', 'thirtyeight'],
  ['39', 'thirty-nine', 'thirtynine'],
  // 40-49
  ['40', 'forty'],
  ['41', 'forty-one', 'fortyone'],
  ['42', 'forty-two', 'fortytwo'],
  ['43', 'forty-three', 'fortythree'],
  ['44', 'forty-four', 'fortyfour'],
  ['45', 'forty-five', 'fortyfive'],
  ['46', 'forty-six', 'fortysix'],
  ['47', 'forty-seven', 'fortyseven'],
  ['48', 'forty-eight', 'fortyeight'],
  ['49', 'forty-nine', 'fortynine'],
  // 50-59
  ['50', 'fifty'],
  ['51', 'fifty-one', 'fiftyone'],
  ['52', 'fifty-two', 'fiftytwo'],
  ['53', 'fifty-three', 'fiftythree'],
  ['54', 'fifty-four', 'fiftyfour'],
  ['55', 'fifty-five', 'fiftyfive'],
  ['56', 'fifty-six', 'fiftysix'],
  ['57', 'fifty-seven', 'fiftyseven'],
  ['58', 'fifty-eight', 'fiftyeight'],
  ['59', 'fifty-nine', 'fiftynine'],
  // 60-69
  ['60', 'sixty'],
  ['61', 'sixty-one', 'sixtyone'],
  ['62', 'sixty-two', 'sixtytwo'],
  ['63', 'sixty-three', 'sixtythree'],
  ['64', 'sixty-four', 'sixtyfour'],
  ['65', 'sixty-five', 'sixtyfive'],
  ['66', 'sixty-six', 'sixtysix'],
  ['67', 'sixty-seven', 'sixtyseven'],
  ['68', 'sixty-eight', 'sixtyeight'],
  ['69', 'sixty-nine', 'sixtynine'],
  // 70-79
  ['70', 'seventy'],
  ['71', 'seventy-one', 'seventyone'],
  ['72', 'seventy-two', 'seventytwo'],
  ['73', 'seventy-three', 'seventythree'],
  ['74', 'seventy-four', 'seventyfour'],
  ['75', 'seventy-five', 'seventyfive'],
  ['76', 'seventy-six', 'seventysix'],
  ['77', 'seventy-seven', 'seventyseven'],
  ['78', 'seventy-eight', 'seventyeight'],
  ['79', 'seventy-nine', 'seventynine'],
  // 80-89
  ['80', 'eighty'],
  ['81', 'eighty-one', 'eightyone'],
  ['82', 'eighty-two', 'eightytwo'],
  ['83', 'eighty-three', 'eightythree'],
  ['84', 'eighty-four', 'eightyfour'],
  ['85', 'eighty-five', 'eightyfive'],
  ['86', 'eighty-six', 'eightysix'],
  ['87', 'eighty-seven', 'eightyseven'],
  ['88', 'eighty-eight', 'eightyeight'],
  ['89', 'eighty-nine', 'eightynine'],
  // 90-99
  ['90', 'ninety'],
  ['91', 'ninety-one', 'ninetyone'],
  ['92', 'ninety-two', 'ninetytwo'],
  ['93', 'ninety-three', 'ninetythree'],
  ['94', 'ninety-four', 'ninetyfour'],
  ['95', 'ninety-five', 'ninetyfive'],
  ['96', 'ninety-six', 'ninetysix'],
  ['97', 'ninety-seven', 'ninetyseven'],
  ['98', 'ninety-eight', 'ninetyeight'],
  ['99', 'ninety-nine', 'ninetynine'],
  // 100
  ['100', 'hundred', 'one hundred'],
  // Ordinals 1st-20th
  ['1st', 'first'],
  ['2nd', 'second'],
  ['3rd', 'third'],
  ['4th', 'fourth'],
  ['5th', 'fifth'],
  ['6th', 'sixth'],
  ['7th', 'seventh'],
  ['8th', 'eighth'],
  ['9th', 'ninth'],
  ['10th', 'tenth'],
  ['11th', 'eleventh'],
  ['12th', 'twelfth'],
  ['13th', 'thirteenth'],
  ['14th', 'fourteenth'],
  ['15th', 'fifteenth'],
  ['16th', 'sixteenth'],
  ['17th', 'seventeenth'],
  ['18th', 'eighteenth'],
  ['19th', 'nineteenth'],
  ['20th', 'twentieth'],
];

/**
 * Combined equivalence groups for lookup.
 */
const ALL_EQUIVALENCE_GROUPS = [
  ...EQUIVALENCE_GROUPS,
  ...HOMOPHONE_GROUPS,
  ...NUMBER_WORDS,
];

/**
 * Build a lookup: normalized word → canonical form.
 * Every word in a group maps to the first entry (canonical).
 */
const wordToCanonical = new Map();

for (const group of ALL_EQUIVALENCE_GROUPS) {
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

/**
 * Get all equivalent forms for a word (for building reference set).
 * Returns array including the word itself.
 * @param {string} word - Normalized word
 * @returns {string[]} All equivalent forms
 */
export function getAllEquivalents(word) {
  for (const group of ALL_EQUIVALENCE_GROUPS) {
    if (group.includes(word)) {
      return [...group];
    }
  }
  return [word];
}
