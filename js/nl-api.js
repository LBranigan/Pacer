// nl-api.js — Google Cloud Natural Language API integration
// Analyzes passage text for POS tags, entities, and word tier classification

// Dolch + Fry top-220 high-frequency sight words
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

// POS tags that indicate function words
const FUNCTION_POS = new Set([
  'DET','PRON','CONJ','ADP','PRT','AFFIX','X','NUM'
]);

// Entity types that indicate proper nouns
const PROPER_ENTITY_TYPES = new Set([
  'PERSON','LOCATION','ORGANIZATION','WORK_OF_ART','EVENT'
]);

/**
 * Simple string hash for sessionStorage caching.
 */
function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return 'nl_' + hash;
}

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Compute Levenshtein similarity ratio (0..1, 1 = identical).
 */
export function levenshteinRatio(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const dist = levenshtein(a.toLowerCase(), b.toLowerCase());
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

/**
 * Classify word tier based on POS, entity, and sight word list.
 */
function classifyTier(word, pos, isProper, entityType) {
  const lower = word.toLowerCase();
  if (isProper || PROPER_ENTITY_TYPES.has(entityType)) return 'proper';
  if (SIGHT_WORDS.has(lower)) return 'sight';
  if (!FUNCTION_POS.has(pos) && ['NOUN','VERB','ADJ','ADV'].includes(pos)) return 'academic';
  return 'function';
}

/**
 * Map NL API syntax + entity results to per-word annotation array.
 */
function mapNLResultsToWords(syntaxResult, entityResult) {
  const tokens = syntaxResult.tokens || [];

  // Build offset -> entityType map from entity mentions
  const offsetToEntity = new Map();
  if (entityResult && entityResult.entities) {
    for (const entity of entityResult.entities) {
      if (entity.mentions) {
        for (const mention of entity.mentions) {
          if (mention.text && mention.text.beginOffset !== undefined) {
            offsetToEntity.set(mention.text.beginOffset, entity.type || null);
          }
        }
      }
    }
  }

  return tokens.map(token => {
    const word = token.text?.content || '';
    const offset = token.text?.beginOffset ?? -1;
    const pos = token.partOfSpeech?.tag || 'UNKNOWN';
    const isProper = token.partOfSpeech?.proper === 'PROPER';
    const lemma = token.lemma || word;
    const entityType = offsetToEntity.get(offset) || null;
    const tier = classifyTier(word, pos, isProper, entityType);

    return { word, offset, pos, lemma, entityType, isProperNoun: isProper || PROPER_ENTITY_TYPES.has(entityType), tier };
  });
}

/**
 * Analyze passage text via Google Cloud NL API.
 * Returns per-word annotation array or null on failure.
 * Results cached in sessionStorage.
 */
export async function analyzePassageText(text, apiKey) {
  if (!text || !apiKey) return null;

  const cacheKey = hashText(text);
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch { /* ignore */ }

  const document = { type: 'PLAIN_TEXT', content: text };

  try {
    const [syntaxRes, entityRes] = await Promise.all([
      fetch(`https://language.googleapis.com/v1/documents:analyzeSyntax?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document, encodingType: 'UTF8' })
      }).then(r => r.json()),
      fetch(`https://language.googleapis.com/v1/documents:analyzeEntities?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document, encodingType: 'UTF8' })
      }).then(r => r.json())
    ]);

    if (syntaxRes.error) throw new Error(syntaxRes.error.message);

    const annotations = mapNLResultsToWords(syntaxRes, entityRes);

    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(annotations));
    } catch { /* storage full, continue */ }

    return annotations;
  } catch (err) {
    console.warn('NL API error:', err);
    return null;
  }
}
