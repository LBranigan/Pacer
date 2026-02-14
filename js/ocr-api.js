/**
 * OCR API module — Cloud Vision + Gemini hybrid text extraction.
 *
 * Cloud Vision: excellent character accuracy, but wrong paragraph ordering on multi-column pages,
 * and sometimes splits one paragraph into multiple fragments.
 * Hybrid mode: Cloud Vision extracts text fragments, Gemini reassembles them into correct
 * reading order by looking at the image, then a cleanup pass fixes OCR artifacts using CMUdict
 * OOV detection + targeted Gemini correction.
 */

import { getPhonemeCount, loadPhonemeData } from './phoneme-counter.js';

/**
 * Resize an image if either dimension exceeds maxDimension.
 * Returns a Promise resolving to a Blob (JPEG 0.85 quality).
 */
export function resizeImageIfNeeded(file, maxDimension = 2048) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      if (width <= maxDimension && height <= maxDimension) {
        URL.revokeObjectURL(img.src);
        resolve(file);
        return;
      }
      const scale = maxDimension / Math.max(width, height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')), 'image/jpeg', 0.85);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image'));
    };
    img.src = URL.createObjectURL(file);
  });
}

/** Convert a File/Blob to base64 string (without data URL prefix). */
function fileToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Extract text from an image using Google Vision OCR (flat text only).
 * @param {File} file - Image file
 * @param {string} apiKey - Google Cloud API key
 * @returns {Promise<string>} Extracted text
 */
export async function extractTextFromImage(file, apiKey) {
  const resized = await resizeImageIfNeeded(file);
  const base64 = await fileToBase64(resized);

  const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        image: { content: base64 },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
      }]
    })
  });

  if (!response.ok) {
    throw new Error(`Vision API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const result = data.responses && data.responses[0];

  if (result && result.error) {
    throw new Error(`Vision API: ${result.error.message}`);
  }

  return (result && result.fullTextAnnotation && result.fullTextAnnotation.text) || '';
}

// ─── Hybrid: Cloud Vision characters + Gemini text assembly + OOV cleanup ───

/**
 * Call Cloud Vision and return the full annotation (not just .text).
 */
async function getVisionAnnotation(base64, apiKey) {
  const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        image: { content: base64 },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
      }]
    })
  });

  if (!response.ok) {
    throw new Error(`Vision API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const result = data.responses && data.responses[0];

  if (result && result.error) {
    throw new Error(`Vision API: ${result.error.message}`);
  }

  return result && result.fullTextAnnotation;
}

/**
 * Reconstruct paragraph text from Cloud Vision's word/symbol hierarchy.
 * Paragraphs have no .text field — must be rebuilt from symbols.
 */
function paraToText(para) {
  return (para.words || [])
    .map(w => (w.symbols || []).map(s => s.text).join(''))
    .join(' ')
    .trim();
}

/**
 * Extract paragraphs from the fullTextAnnotation hierarchy.
 * Returns array of text strings for TEXT blocks only.
 */
function extractParagraphs(annotation) {
  const paragraphs = [];
  if (!annotation || !annotation.pages) return paragraphs;

  for (const page of annotation.pages) {
    for (const block of (page.blocks || [])) {
      // Skip non-text blocks (tables, pictures, barcodes, etc.)
      if (block.blockType && block.blockType !== 'TEXT') continue;

      for (const para of (block.paragraphs || [])) {
        const text = paraToText(para);
        if (text) {
          paragraphs.push(text);
        }
      }
    }
  }
  return paragraphs;
}

/**
 * Extract a sorted array of lowercase alphanumeric tokens from text.
 * Used for word-bag validation: ensures Gemini didn't hallucinate words.
 */
function extractWordBag(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).sort();
}

/**
 * Subset validation: every word in Gemini's output must come from Cloud Vision's input.
 * Gemini SHOULD drop junk (line numbers, page numbers, comprehension questions).
 * But Gemini must NOT hallucinate new words. Subset check catches that.
 * Returns { ok, hallucinated[] }.
 */
function validateSubset(inputBag, outputBag) {
  const available = new Map();
  for (const w of inputBag) available.set(w, (available.get(w) || 0) + 1);

  const used = new Map();
  const hallucinated = [];
  for (const w of outputBag) {
    const usedCount = used.get(w) || 0;
    const availCount = available.get(w) || 0;
    if (usedCount < availCount) {
      used.set(w, usedCount + 1);
    } else {
      hallucinated.push(w);
    }
  }

  return { ok: hallucinated.length === 0, hallucinated };
}

/**
 * Ask Gemini to reassemble Cloud Vision text fragments into correct reading order.
 * Subset validation ensures Gemini didn't hallucinate new words.
 * Gemini is expected to drop junk (line numbers, page numbers, comprehension questions).
 */
async function assembleWithGemini(base64, mimeType, fragments, geminiKey) {
  const numberedList = fragments
    .map((text, i) => `[${i + 1}] ${text}`)
    .join('\n');

  const prompt = `You are reassembling text fragments extracted via OCR from a reading assessment page. The OCR extracted text with excellent character accuracy, but the fragments may be in the wrong order or incorrectly split across paragraph boundaries.

Look at the image and reassemble ONLY the reading passage in the correct reading order. For two-column layouts, read the left column top-to-bottom first, then the right column top-to-bottom.

CRITICAL RULES:
- Output ONLY the reading passage — drop line numbers, page numbers, comprehension questions, answer choices, and margin annotations
- Use ONLY the exact text from these fragments for passage words
- Do NOT correct any words, even if they look like OCR errors (e.g., keep "6ageography" as-is)
- Do NOT add any words that aren't in the fragments
- Merge fragments that belong to the same paragraph into a single paragraph
- Separate distinct paragraphs with a blank line

Fragments:
${numberedList}

Return ONLY the reassembled passage text. No explanation, no commentary.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: prompt }
          ]
        }]
      })
    }
  );

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    if (response.status === 429) {
      throw new Error('Gemini rate limit');
    }
    throw new Error(`Gemini API error: ${response.status} ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked: ${data.promptFeedback.blockReason}`);
  }

  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new Error('Gemini returned no candidates');
  }

  if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'RECITATION') {
    throw new Error(`Gemini blocked (${candidate.finishReason})`);
  }

  const assembled = (candidate.content?.parts?.[0]?.text || '').trim();
  if (!assembled) {
    throw new Error('Gemini returned empty text');
  }

  // Subset validation: every output word must come from Cloud Vision's input.
  const inputBag = extractWordBag(fragments.join(' '));
  const outputBag = extractWordBag(assembled);
  const validation = validateSubset(inputBag, outputBag);

  if (!validation.ok) {
    console.warn('[OCR Hybrid] Gemini hallucinated words not in Cloud Vision input:',
      validation.hallucinated.slice(0, 15).join(', '));
    throw new Error(`Subset validation failed — ${validation.hallucinated.length} hallucinated words`);
  }

  return assembled;
}

// ─── OOV Cleanup: CMUdict detection + Gemini correction ───

/**
 * Find OOV (out-of-vocabulary) words in text using CMUdict.
 * Returns array of { token, normalized, contextBefore, contextAfter }
 * for each word not found in the 125K-word CMUdict dictionary.
 */
function findOOVWords(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const oovWords = [];
  const seen = new Set(); // deduplicate — same token only flagged once

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // Normalize: lowercase, strip leading/trailing non-alpha characters
    const normalized = token.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
    if (!normalized || normalized.length < 2) continue; // skip single chars, pure punctuation

    // Skip if already flagged this exact normalized form
    if (seen.has(normalized)) continue;

    // Check CMUdict — null means OOV
    if (getPhonemeCount(normalized) !== null) continue;

    // Also check without hyphens (e.g., "twenty-four" → "twentyfour" might not match,
    // but "twenty" and "four" individually would)
    const hyphenParts = normalized.split('-').filter(Boolean);
    if (hyphenParts.length > 1 && hyphenParts.every(p => getPhonemeCount(p) !== null)) continue;

    seen.add(normalized);

    // Gather context: 5 words before and after
    const contextBefore = tokens.slice(Math.max(0, i - 5), i).join(' ');
    const contextAfter = tokens.slice(i + 1, i + 6).join(' ');

    oovWords.push({ token, normalized, contextBefore, contextAfter });
  }

  return oovWords;
}

/**
 * Send OOV words to Gemini for targeted correction.
 * Gemini determines for each word whether it's an OCR artifact (correct it),
 * a foreign/proper word (keep it), or a line number/junk (remove it).
 *
 * Text-only call — no image needed, fast and cheap.
 * Returns a map: originalToken → corrected string (or empty string for removal).
 */
async function correctOOVWithGemini(oovWords, geminiKey) {
  const wordList = oovWords.map((w, i) =>
    `${i + 1}. "${w.token}" — context: "...${w.contextBefore} [${w.token}] ${w.contextAfter}..."`
  ).join('\n');

  const prompt = `These words were found in OCR-extracted text from a children's reading assessment passage. They are NOT in the English dictionary. For each word, determine what it is and what action to take.

Actions:
- "correct": The word is an OCR artifact (digits fused with letters, fused words, garbled text). Provide the corrected version.
- "keep": The word is a foreign word, proper noun, place name, or specialized term that is correct as-is.
- "remove": The word is a stray line number, page number, or scanning artifact that should be deleted.

Words:
${wordList}

Return a JSON array with one object per word:
[{"word": "6ageography", "action": "correct", "correction": "geography"}, {"word": "cayuco", "action": "keep"}, ...]

For "correct" actions, provide ONLY the corrected word/phrase. For "keep" and "remove", omit the "correction" field.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          response_mime_type: 'application/json'
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini OOV cleanup error: ${response.status}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new Error('Gemini OOV cleanup returned no candidates');
  }

  const text = candidate.content?.parts?.[0]?.text || '';
  let corrections;
  try {
    corrections = JSON.parse(text);
  } catch {
    throw new Error(`Gemini OOV cleanup returned invalid JSON: ${text.slice(0, 100)}`);
  }

  if (!Array.isArray(corrections)) {
    throw new Error('Gemini OOV cleanup did not return an array');
  }

  // Build correction map: original token → replacement
  const correctionMap = new Map();
  for (const entry of corrections) {
    if (!entry || !entry.word) continue;

    // Find the original token that matches this word
    const match = oovWords.find(w =>
      w.normalized === entry.word.toLowerCase().replace(/[^a-z]/g, '') ||
      w.token === entry.word ||
      w.token.toLowerCase().includes(entry.word.toLowerCase())
    );
    if (!match) continue;

    if (entry.action === 'correct' && entry.correction) {
      correctionMap.set(match.token, entry.correction);
    } else if (entry.action === 'remove') {
      correctionMap.set(match.token, '');
    }
    // "keep" → no entry in map → token stays as-is
  }

  return correctionMap;
}

/**
 * Apply OOV corrections to assembled text.
 * Each correction replaces the exact original token.
 */
function applyCorrections(text, correctionMap) {
  let result = text;
  for (const [original, replacement] of correctionMap) {
    if (replacement === '') {
      // Remove: delete the token and any trailing/leading extra whitespace
      result = result.split(original).join('').replace(/  +/g, ' ');
    } else {
      // Replace: swap exact token
      result = result.split(original).join(replacement);
    }
  }
  return result.trim();
}

/**
 * Full OOV cleanup pass: find OOV words via CMUdict, send to Gemini for correction.
 * Returns cleaned text. If cleanup fails, returns original text unchanged.
 */
async function cleanupOOV(text, geminiKey) {
  await loadPhonemeData();

  const oovWords = findOOVWords(text);
  if (oovWords.length === 0) {
    console.info('[OCR Cleanup] No OOV words found — text is clean');
    return { text, oovCount: 0, fixCount: 0 };
  }

  console.info(`[OCR Cleanup] Found ${oovWords.length} OOV words:`,
    oovWords.map(w => w.normalized).join(', '));

  try {
    const corrections = await correctOOVWithGemini(oovWords, geminiKey);
    const fixCount = corrections.size;

    if (fixCount === 0) {
      console.info('[OCR Cleanup] Gemini kept all OOV words as-is (foreign/proper nouns)');
      return { text, oovCount: oovWords.length, fixCount: 0 };
    }

    console.info(`[OCR Cleanup] Applying ${fixCount} corrections:`,
      [...corrections.entries()].map(([k, v]) => `"${k}" → "${v || '[removed]'}"`).join(', '));

    const cleaned = applyCorrections(text, corrections);
    return { text: cleaned, oovCount: oovWords.length, fixCount };
  } catch (err) {
    console.warn('[OCR Cleanup] Gemini OOV correction failed, keeping original text:', err.message);
    return { text, oovCount: oovWords.length, fixCount: 0 };
  }
}

// ─── Main hybrid entry point ───

/**
 * Hybrid OCR: Cloud Vision + Gemini assembly + OOV cleanup.
 *
 * 1. Cloud Vision extracts the full paragraph hierarchy (excellent character accuracy)
 * 2. Gemini assembles fragments into correct reading order, drops junk
 * 3. CMUdict identifies OOV words in the assembled text
 * 4. Gemini corrects OCR artifacts while preserving foreign words and proper nouns
 *
 * If any step fails, falls back gracefully (assembly → raw Vision, cleanup → uncleaned).
 *
 * @param {File} file - Image file
 * @param {string} visionKey - Google Cloud API key
 * @param {string} geminiKey - Gemini API key
 * @returns {Promise<{text: string, engine: string}>} Extracted text + which engine path was used
 */
export async function extractTextHybrid(file, visionKey, geminiKey) {
  const resized = await resizeImageIfNeeded(file);
  const base64 = await fileToBase64(resized);
  const mimeType = resized.type || 'image/jpeg';

  // Step 1: Cloud Vision — get full annotation
  const annotation = await getVisionAnnotation(base64, visionKey);
  const flatText = (annotation && annotation.text) || '';

  if (!flatText) {
    return { text: '', engine: 'vision (empty)' };
  }

  // Step 2: Extract all fragments from hierarchy
  const paragraphs = extractParagraphs(annotation);

  if (paragraphs.length <= 1) {
    return { text: flatText, engine: 'vision (single paragraph)' };
  }

  // Step 3: Gemini assembles fragments into correct reading order
  let assembled;
  try {
    assembled = await assembleWithGemini(base64, mimeType, paragraphs, geminiKey);
  } catch (err) {
    console.warn('[OCR Hybrid] Gemini assembly failed, using Cloud Vision ordering:', err.message);
    return { text: flatText, engine: `vision fallback (${err.message})` };
  }

  // Step 4: OOV cleanup — find non-dictionary words, ask Gemini to fix artifacts
  const cleanup = await cleanupOOV(assembled, geminiKey);
  const cleanupInfo = cleanup.oovCount > 0
    ? `, ${cleanup.fixCount}/${cleanup.oovCount} OOV fixed`
    : '';

  return {
    text: cleanup.text,
    engine: `hybrid (${paragraphs.length} fragments assembled${cleanupInfo})`
  };
}
