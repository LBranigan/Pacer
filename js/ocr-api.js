/**
 * OCR API module — Cloud Vision + Gemini hybrid text extraction.
 *
 * Cloud Vision: excellent character accuracy, but wrong paragraph ordering on multi-column pages,
 * and sometimes splits one paragraph into multiple fragments.
 * Hybrid mode: Cloud Vision extracts text fragments, Gemini reassembles them into correct
 * reading order by looking at the image. Superset word-bag validation ensures no Cloud Vision words are lost.
 */

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

// ─── Hybrid: Cloud Vision characters + Gemini text assembly ───

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
 * Used for word-bag validation: ensures Gemini didn't add, remove, or change words.
 */
function extractWordBag(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).sort();
}

/**
 * Check that every token in inputBag appears in outputBag (with same or greater count).
 * Gemini may add extra words from the image (comprehension questions, margin text) —
 * that's harmless (teacher deletes extras in textarea). But Gemini removing or changing
 * Cloud Vision words would be dangerous, so we reject if any input word is missing.
 * Returns { ok, missing[], extra[] }.
 */
function validateWordBag(inputBag, outputBag) {
  // Build frequency maps
  const inputFreq = new Map();
  for (const w of inputBag) inputFreq.set(w, (inputFreq.get(w) || 0) + 1);
  const outputFreq = new Map();
  for (const w of outputBag) outputFreq.set(w, (outputFreq.get(w) || 0) + 1);

  // Check every input word appears in output with at least the same count
  const missing = [];
  for (const [word, count] of inputFreq) {
    const outCount = outputFreq.get(word) || 0;
    if (outCount < count) {
      missing.push(word);
    }
  }

  // Identify extra words Gemini added (for logging only)
  const extra = [];
  for (const [word, count] of outputFreq) {
    const inCount = inputFreq.get(word) || 0;
    if (count > inCount) {
      extra.push(word);
    }
  }

  return { ok: missing.length === 0, missing, extra };
}

/**
 * Ask Gemini to reassemble Cloud Vision text fragments into correct reading order.
 *
 * Instead of returning fragment numbers, Gemini outputs the fully reassembled text.
 * This lets Gemini use reading comprehension to handle sentence-level merging
 * (e.g., placing "my favorite" correctly within "But my favorite class is phys ed").
 *
 * Superset word-bag validation ensures Gemini preserved all Cloud Vision words.
 * Extra words (Gemini reading the image) are allowed — teacher deletes in textarea.
 * If Gemini removed or changed any Cloud Vision words, throws → falls back.
 */
async function assembleWithGemini(base64, mimeType, fragments, geminiKey) {
  const numberedList = fragments
    .map((text, i) => `[${i + 1}] ${text}`)
    .join('\n');

  const prompt = `You are reassembling text fragments extracted via OCR from a reading assessment page. The OCR extracted text with excellent character accuracy, but the fragments may be in the wrong order or incorrectly split across paragraph boundaries.

Look at the image and reassemble these fragments into the correct reading order. For two-column layouts, read the left column top-to-bottom first, then the right column top-to-bottom.

CRITICAL RULES:
- Use ONLY the exact text from these fragments
- Do NOT correct any words, even if they look like OCR errors
- Do NOT add, remove, or change any words or punctuation
- Include ALL fragments — do not skip any
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

  // Word-bag validation: ensure Gemini preserved all Cloud Vision words.
  // Extra words (from image) are allowed — teacher deletes in textarea.
  // Missing/changed words are rejected — Cloud Vision's text is ground truth.
  const inputBag = extractWordBag(fragments.join(' '));
  const outputBag = extractWordBag(assembled);
  const validation = validateWordBag(inputBag, outputBag);

  if (validation.extra.length > 0) {
    console.info(`[OCR Hybrid] Gemini added ${validation.extra.length} extra words:`,
      validation.extra.slice(0, 15).join(', '));
  }

  if (!validation.ok) {
    console.warn('[OCR Hybrid] Gemini removed/changed words.',
      `Missing: ${validation.missing.slice(0, 15).join(', ')}`);
    throw new Error(`Word-bag validation failed — ${validation.missing.length} words missing`);
  }

  return assembled;
}

/**
 * Hybrid OCR: Cloud Vision for character accuracy + Gemini for text assembly.
 *
 * 1. Cloud Vision extracts the full paragraph hierarchy (excellent character accuracy)
 * 2. All fragments sent to Gemini (no junk filtering — Gemini handles everything)
 * 3. Gemini reassembles fragments in correct reading order using image + text
 * 4. Word-bag validation: all Cloud Vision words must be in output
 *
 * If Gemini fails or removes words, falls back to Cloud Vision's raw ordering.
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

  // Step 2: Extract all fragments from hierarchy (no filtering — Gemini handles everything)
  const paragraphs = extractParagraphs(annotation);

  if (paragraphs.length <= 1) {
    return { text: flatText, engine: 'vision (single paragraph)' };
  }

  // Step 3: Gemini assembles fragments into correct reading order
  try {
    const assembled = await assembleWithGemini(base64, mimeType, paragraphs, geminiKey);
    return { text: assembled, engine: `hybrid (${paragraphs.length} fragments assembled)` };
  } catch (err) {
    console.warn('[OCR Hybrid] Gemini assembly failed, using Cloud Vision ordering:', err.message);
    return { text: flatText, engine: `vision fallback (${err.message})` };
  }
}
