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
  // ── Titles & honorifics ──
  ['vs', 'versus', 'verses'],
  ['mr', 'mister'],
  ['mrs', 'missus', 'misses'],
  ['ms', 'miss', 'miz'],
  ['dr', 'doctor'],
  ['st', 'saint', 'street'],
  ['jr', 'junior'],
  ['sr', 'senior'],
  ['gov', 'governor'],
  ['pres', 'president'],
  ['sen', 'senator'],
  ['rep', 'representative'],
  ['rev', 'reverend'],
  ['prof', 'professor'],
  ['gen', 'general'],
  ['col', 'colonel'],
  ['maj', 'major'],
  ['capt', 'captain'],
  ['sgt', 'sergeant'],
  ['lt', 'lieutenant'],
  ['cpl', 'corporal'],
  ['pvt', 'private'],
  ['cmdr', 'commander'],
  ['adm', 'admiral'],

  // ── Address & place ──
  ['ave', 'avenue'],
  ['blvd', 'boulevard'],
  ['rd', 'road'],
  ['ln', 'lane'],
  ['ct', 'court'],
  ['pl', 'place'],
  ['hwy', 'highway'],
  ['pkwy', 'parkway'],
  ['apt', 'apartment'],
  ['bldg', 'building'],

  // ── Compass directions (multi-letter only; single letters too ambiguous) ──
  ['ne', 'northeast'],
  ['nw', 'northwest'],
  ['se', 'southeast'],
  ['sw', 'southwest'],

  // ── Organizations & business ──
  ['dept', 'department'],
  ['govt', 'government'],
  ['inc', 'incorporated'],
  ['ltd', 'limited'],
  ['co', 'company', 'county'],
  ['corp', 'corporation'],
  ['assn', 'assoc', 'association'],
  ['natl', 'national'],
  ['intl', 'international'],

  // ── Common abbreviation expansions (after normalizeText strips periods) ──
  ['etc', 'etcetera'],
  ['mt', 'mount', 'mountain'],
  ['ft', 'fort', 'foot', 'feet'],
  ['vol', 'volume'],
  ['fig', 'figure'],
  ['approx', 'approximately'],
  ['info', 'information'],
  ['tv', 'television'],

  // ── Measurement: metric ──
  ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres'],
  ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres'],
  ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'],
  ['kg', 'kilogram', 'kilograms'],
  ['mg', 'milligram', 'milligrams'],
  ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'],

  // ── Measurement: imperial / US customary ──
  ['oz', 'ounce', 'ounces'],
  ['lb', 'lbs', 'pound', 'pounds'],
  ['yd', 'yard', 'yards'],
  ['mi', 'mile', 'miles'],
  ['gal', 'gallon', 'gallons'],
  ['pt', 'pint', 'pints'],
  ['qt', 'quart', 'quarts'],
  ['tsp', 'teaspoon', 'teaspoons'],
  ['tbsp', 'tablespoon', 'tablespoons'],

  // ── Measurement: other ──
  ['sq', 'square'],
  ['cu', 'cubic'],
  ['deg', 'degree', 'degrees'],

  // ── Time units ──
  // Note: 'hr'/'hours' handled in HOMOPHONE_GROUPS with 'our'/'hour'
  ['min', 'minute', 'minutes'],
  ['sec', 'seconds'],  // 'second' omitted — conflicts with ordinal ['2nd', 'second']
  ['yr', 'year', 'years'],
  ['mo', 'month', 'months'],
  ['wk', 'week', 'weeks'],

  // ── Days of the week (after normalizeText strips periods: "Mon." → "mon") ──
  ['mon', 'monday'],
  ['tue', 'tues', 'tuesday'],
  ['wed', 'wednesday'],
  ['thu', 'thur', 'thurs', 'thursday'],
  ['fri', 'friday'],
  ['sat', 'saturday'],
  // Note: 'sun'/'sunday' handled in HOMOPHONE_GROUPS with 'sun'/'son'

  // ── Months of the year (after period strip: "Jan." → "jan") ──
  ['jan', 'january'],
  ['feb', 'february'],
  ['mar', 'march'],
  ['apr', 'april'],
  ['aug', 'august'],
  ['sep', 'sept', 'september'],
  ['oct', 'october'],
  ['nov', 'november'],
  ['dec', 'december'],

  // ── Contractions ↔ expanded forms ──
  // Keys are apostrophe-free to match normalizeText output ("don't" → "dont").
  // Known collisions (were/we're, well/we'll) are acceptable: they sound
  // different so ASR distinguishes them, and cross-validation catches errors.
  ['cant', 'cannot', 'can not'],
  ['wont', 'will not'],
  ['dont', 'do not'],
  ['doesnt', 'does not'],
  ['didnt', 'did not'],
  ['isnt', 'is not'],
  ['arent', 'are not'],
  ['wasnt', 'was not'],
  ['werent', 'were not'],
  ['hasnt', 'has not'],
  ['havent', 'have not'],
  ['hadnt', 'had not'],
  ['wouldnt', 'would not'],
  ['couldnt', 'could not'],
  ['shouldnt', 'should not'],
  ['im', 'i am'],
  ['ill', 'i will'],
  ['ive', 'i have'],
  ['id', 'i would', 'i had'],
  ['wed', 'we would', 'we had'],
  ['were', 'we are'],
  ['weve', 'we have'],
  ['well', 'we will'],
  ['theyre', 'they are'],
  ['theyve', 'they have'],
  ['theyll', 'they will'],
  ['youre', 'you are'],
  ['youve', 'you have'],
  ['youll', 'you will'],
  ['hes', 'he is', 'he has'],
  ['shes', 'she is', 'she has'],
  ['its', 'it is', 'it has'],
  ['thats', 'that is', 'that has'],
  ['theres', 'there is', 'there has'],
  ['heres', 'here is', 'here has'],
  ['whats', 'what is', 'what has'],
  ['whos', 'who is', 'who has'],
  ['lets', 'let us'],

  // ── Numbers written as digits ↔ words ──
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

  // ── Symbols ──
  ['&', 'and'],
  ['%', 'percent'],

  // ── Article / determiner variants ──
  // "a" vs "an" is a phonetic alternation, not a reading error.
  // Students naturally adjust based on the following sound.
  ['a', 'an'],

  // ── Common alternate forms ──
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
  ['their', 'there', 'theyre'],
  ['your', 'youre'],
  // "it's" → "its" after normalizeText; contraction group handles "its"↔"it is"
  ['to', 'too', 'two'],
  ['by', 'bye', 'buy'],
  ['for', 'four', 'fore'],
  ['no', 'know'],
  ['new', 'knew', 'gnu'],
  ['right', 'write', 'rite'],
  ['see', 'sea'],
  ['be', 'bee'],
  ['hear', 'here'],
  ['our', 'hour', 'hr', 'hours'],  // Extended: hr/hours abbreviation
  ['ate', 'eight'],
  ['one', 'won'],
  ['sun', 'son', 'sunday'],  // Extended: Sun. abbreviation for Sunday
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
  // Ordinals 21st-100th
  // Joined forms (e.g., "twentyfirst") match normalizeText splitting "twenty-first" → ["twenty","first"]
  // which compound merge then recombines to "twentyfirst" for canonical lookup.
  ['21st', 'twentyfirst'],
  ['22nd', 'twentysecond'],
  ['23rd', 'twentythird'],
  ['24th', 'twentyfourth'],
  ['25th', 'twentyfifth'],
  ['26th', 'twentysixth'],
  ['27th', 'twentyseventh'],
  ['28th', 'twentyeighth'],
  ['29th', 'twentyninth'],
  ['30th', 'thirtieth'],
  ['31st', 'thirtyfirst'],
  ['32nd', 'thirtysecond'],
  ['33rd', 'thirtythird'],
  ['34th', 'thirtyfourth'],
  ['35th', 'thirtyfifth'],
  ['36th', 'thirtysixth'],
  ['37th', 'thirtyseventh'],
  ['38th', 'thirtyeighth'],
  ['39th', 'thirtyninth'],
  ['40th', 'fortieth'],
  ['41st', 'fortyfirst'],
  ['42nd', 'fortysecond'],
  ['43rd', 'fortythird'],
  ['44th', 'fortyfourth'],
  ['45th', 'fortyfifth'],
  ['46th', 'fortysixth'],
  ['47th', 'fortyseventh'],
  ['48th', 'fortyeighth'],
  ['49th', 'fortyninth'],
  ['50th', 'fiftieth'],
  ['51st', 'fiftyfirst'],
  ['52nd', 'fiftysecond'],
  ['53rd', 'fiftythird'],
  ['54th', 'fiftyfourth'],
  ['55th', 'fiftyfifth'],
  ['56th', 'fiftysixth'],
  ['57th', 'fiftyseventh'],
  ['58th', 'fiftyeighth'],
  ['59th', 'fiftyninth'],
  ['60th', 'sixtieth'],
  ['61st', 'sixtyfirst'],
  ['62nd', 'sixtysecond'],
  ['63rd', 'sixtythird'],
  ['64th', 'sixtyfourth'],
  ['65th', 'sixtyfifth'],
  ['66th', 'sixtysixth'],
  ['67th', 'sixtyseventh'],
  ['68th', 'sixtyeighth'],
  ['69th', 'sixtyninth'],
  ['70th', 'seventieth'],
  ['71st', 'seventyfirst'],
  ['72nd', 'seventysecond'],
  ['73rd', 'seventythird'],
  ['74th', 'seventyfourth'],
  ['75th', 'seventyfifth'],
  ['76th', 'seventysixth'],
  ['77th', 'seventyseventh'],
  ['78th', 'seventyeighth'],
  ['79th', 'seventyninth'],
  ['80th', 'eightieth'],
  ['81st', 'eightyfirst'],
  ['82nd', 'eightysecond'],
  ['83rd', 'eightythird'],
  ['84th', 'eightyfourth'],
  ['85th', 'eightyfifth'],
  ['86th', 'eightysixth'],
  ['87th', 'eightyseventh'],
  ['88th', 'eightyeighth'],
  ['89th', 'eightyninth'],
  ['90th', 'ninetieth'],
  ['91st', 'ninetyfirst'],
  ['92nd', 'ninetysecond'],
  ['93rd', 'ninetythird'],
  ['94th', 'ninetyfourth'],
  ['95th', 'ninetyfifth'],
  ['96th', 'ninetysixth'],
  ['97th', 'ninetyseventh'],
  ['98th', 'ninetyeighth'],
  ['99th', 'ninetyninth'],
  ['100th', 'hundredth', 'one hundredth'],
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
