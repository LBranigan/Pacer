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
 * Subset validation: every word in Gemini's output must come from Cloud Vision's input.
 * Gemini SHOULD drop junk (line numbers, page numbers, comprehension questions) — that's
 * the whole point. But Gemini must NOT hallucinate new words. Subset check catches that.
 * Returns { ok, hallucinated[] }.
 */
function validateSubset(inputBag, outputBag) {
  // Build frequency map of available input words
  const available = new Map();
  for (const w of inputBag) available.set(w, (available.get(w) || 0) + 1);

  // Check every output word exists in input with sufficient count
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
 *
 * Instead of returning fragment numbers, Gemini outputs the fully reassembled text.
 * This lets Gemini use reading comprehension to handle sentence-level merging
 * (e.g., placing "my favorite" correctly within "But my favorite class is phys ed").
 *
 * Subset word-bag validation ensures Gemini didn't hallucinate new words.
 * Gemini is expected to drop junk (line numbers, page numbers, comprehension questions).
 * If Gemini adds words not in Cloud Vision's output, throws → falls back.
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
  // Gemini is expected to drop junk (line numbers, comprehension questions).
  // But Gemini must not hallucinate words that weren't in the input.
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

/**
 * Hybrid OCR: Cloud Vision for character accuracy + Gemini for text assembly.
 *
 * 1. Cloud Vision extracts the full paragraph hierarchy (excellent character accuracy)
 * 2. All fragments sent to Gemini — it reassembles the reading passage only
 * 3. Gemini drops junk (line numbers, page numbers, comprehension questions)
 * 4. Subset validation: every output word must exist in Cloud Vision input (no hallucinations)
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
