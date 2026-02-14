/**
 * OCR API module — Cloud Vision + Gemini hybrid text extraction.
 *
 * Cloud Vision: excellent character accuracy, but wrong paragraph ordering on multi-column pages.
 * Hybrid mode: Cloud Vision extracts text, Gemini reorders paragraphs by looking at the image.
 * Gemini never generates passage text — it only returns paragraph numbers — so zero hallucination risk.
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

// ─── Hybrid: Cloud Vision characters + Gemini paragraph reordering ───

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
 * Returns array of { text, index } for TEXT blocks only.
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
 * Ask Gemini to reorder numbered paragraphs by looking at the image.
 * Returns a JSON array of paragraph numbers in correct reading order.
 * Gemini never generates passage text — only returns numbers.
 */
async function reorderWithGemini(base64, mimeType, paragraphs, geminiKey) {
  const numberedList = paragraphs
    .map((text, i) => `[${i + 1}] ${text}`)
    .join('\n');

  const prompt = `These numbered text fragments were extracted via OCR from the reading assessment page shown in the image. The fragments may be in the wrong reading order.

Look at the image and return the correct reading order as a JSON array of fragment numbers. For two-column layouts, read the left column top-to-bottom first, then the right column top-to-bottom.

Include ONLY passage text fragments (title, introduction, body text). EXCLUDE any fragments that are clearly line numbers, page numbers, comprehension questions, answer choices, or margin annotations.

Fragments:
${numberedList}

Return ONLY a JSON array of integers, e.g. [3, 1, 5, 2, 4]. No other text.`;

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
        }],
        generationConfig: {
          response_mime_type: 'application/json'
        }
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

  const text = candidate.content?.parts?.[0]?.text || '';
  let order;
  try {
    order = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 100)}`);
  }

  // Validate: array of integers, each in [1, N], no duplicates
  const maxN = paragraphs.length;
  if (!Array.isArray(order) || order.length === 0) {
    throw new Error('Gemini returned empty or non-array response');
  }
  const seen = new Set();
  for (const n of order) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > maxN) {
      throw new Error(`Gemini returned invalid paragraph number: ${n} (max: ${maxN})`);
    }
    if (seen.has(n)) {
      throw new Error(`Gemini returned duplicate paragraph number: ${n}`);
    }
    seen.add(n);
  }

  return order;
}

/**
 * Hybrid OCR: Cloud Vision for character accuracy + Gemini for reading order.
 *
 * 1. Cloud Vision extracts the full paragraph hierarchy (excellent character accuracy)
 * 2. Paragraphs are numbered and sent to Gemini along with the image
 * 3. Gemini returns the correct reading order as a JSON array of numbers
 * 4. Text is reassembled in Gemini's order using Cloud Vision's character-perfect text
 *
 * If Gemini fails for any reason, falls back to Cloud Vision's raw ordering.
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

  // Step 2: Extract paragraphs from hierarchy
  const paragraphs = extractParagraphs(annotation);

  if (paragraphs.length <= 1) {
    // Single paragraph — no reordering needed
    return { text: flatText, engine: 'vision (single paragraph)' };
  }

  // Step 3: Gemini reorder
  try {
    const order = await reorderWithGemini(base64, mimeType, paragraphs, geminiKey);
    const reorderedText = order.map(i => paragraphs[i - 1]).join('\n');
    return { text: reorderedText, engine: `hybrid (vision + gemini, ${paragraphs.length} paragraphs → ${order.length} kept)` };
  } catch (err) {
    console.warn('[OCR Hybrid] Gemini reorder failed, using Cloud Vision ordering:', err.message);
    return { text: flatText, engine: `vision (gemini fallback: ${err.message})` };
  }
}
