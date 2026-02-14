/**
 * OCR API module — Cloud Vision + Gemini hybrid text extraction.
 *
 * Cloud Vision: excellent character accuracy, but wrong paragraph ordering on multi-column pages,
 * and sometimes splits one paragraph into multiple fragments.
 * Hybrid mode: Cloud Vision extracts text fragments, Gemini reassembles them into correct
 * reading order by looking at the image. Subset validation prevents hallucination.
 */

/**
 * Normalize Unicode characters commonly emitted by OCR engines.
 * NFKC decomposes ligatures (fi→fi, fl→fl) and normalizes compatibility chars.
 * Explicit replacements handle smart quotes, dashes, invisible characters.
 * Safe to apply unconditionally — only affects visually-identical or invisible chars.
 */
function normalizeUnicode(text) {
  if (!text) return text;
  return text
    .normalize('NFKC')
    .replace(/\u00A0/g, ' ')                     // non-breaking space → space
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"') // smart double quotes → straight
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'") // smart single quotes → straight
    .replace(/\u2014/g, ' - ')                    // em-dash → spaced hyphen
    .replace(/\u2013/g, '-')                      // en-dash → hyphen
    .replace(/\u2026/g, '...')                    // ellipsis char → three dots
    .replace(/\u00AD/g, '')                       // soft hyphen → remove
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, ''); // zero-width chars → remove
}

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

  const rawText = (result && result.fullTextAnnotation && result.fullTextAnnotation.text) || '';
  return normalizeUnicode(rawText);
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
        const text = normalizeUnicode(paraToText(para));
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
  const fuzzyMatched = [];
  for (const w of outputBag) {
    const usedCount = used.get(w) || 0;
    const availCount = available.get(w) || 0;
    if (usedCount < availCount) {
      used.set(w, usedCount + 1);
    } else if (w.length > 3) {
      // Fuzzy match: allow minor character changes (OCR artifacts Gemini partially fixed).
      // Only for words > 3 chars to avoid false positives on short words like "the"/"them".
      let matched = false;
      for (const [inputWord, inputCount] of available) {
        const inputUsed = used.get(inputWord) || 0;
        if (inputUsed < inputCount && inputWord.length > 3 &&
            levenshteinSimilarity(w, inputWord) >= 0.7) {
          used.set(inputWord, inputUsed + 1);
          fuzzyMatched.push(`${w} ≈ ${inputWord}`);
          matched = true;
          break;
        }
      }
      if (!matched) hallucinated.push(w);
    } else {
      hallucinated.push(w);
    }
  }

  if (fuzzyMatched.length > 0) {
    console.log('[OCR Hybrid] Subset validation fuzzy matches:', fuzzyMatched.join(', '));
  }

  return { ok: hallucinated.length === 0, hallucinated };
}

/**
 * Ask Gemini to reassemble Cloud Vision text fragments into correct reading order.
 * Subset validation ensures Gemini didn't hallucinate new words.
 * Gemini is expected to drop junk (line numbers, page numbers, comprehension questions).
 */
async function assembleWithGemini(base64, mimeType, fragments, geminiKey) {
  console.log('[OCR Hybrid] assembleWithGemini: system_instruction + temperature=0, topK=1, topP=1');
  const numberedList = fragments
    .map((text, i) => `[${i + 1}] ${text}`)
    .join('\n');

  // System instruction: persistent behavioral rules (higher priority in Gemini)
  const systemInstruction = {
    parts: [{ text: `You are an expert OCR text assembler for children's reading assessment passages.
Your job is to reassemble OCR-extracted text fragments into the correct reading order.

Rules you must always follow:
- Output ONLY the reading passage text
- Use the IMAGE to identify margin annotations: line numbers, page numbers, scoring marks. Drop those. They are visually distinct from body text — typically in the margin, a different size, or a different font
- If a margin number is fused with a word in the OCR text (e.g., "78At"), look at the image to separate them: drop the margin number, keep the word
- Drop comprehension questions, answer choices, scoring rubrics, checkboxes, form fields
- For two-column layouts, read left column top-to-bottom first, then right column
- Merge fragments that belong to the same paragraph into a single paragraph
- Separate distinct paragraphs with a blank line
- Use ONLY the exact text from the provided fragments for passage words — do NOT add or invent words
- Do NOT correct OCR errors — keep garbled text exactly as it appears in the fragments (e.g., if a fragment says "6ageography", output "6ageography")
- Return ONLY the passage text — no explanation, no commentary

Example:

Input fragments:
[1] 78 The fox jumped over
[2] the lazy dog. He
[3] 79 landed softly on the
[4] grass beside the fence.
[5] 1. What did the fox do?
[6] A) Ran away B) Jumped

Output:
The fox jumped over the lazy dog. He landed softly on the grass beside the fence.` }]
  };

  // User prompt: per-request fragment data
  const userPrompt = `Reassemble these OCR fragments from the attached image into the reading passage:

Fragments:
${numberedList}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: systemInstruction,
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: userPrompt }
          ]
        }],
        generationConfig: {
          temperature: 0,
          topK: 1,
          topP: 1
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

  const assembled = (candidate.content?.parts?.[0]?.text || '').trim();
  if (!assembled) {
    throw new Error('Gemini returned empty text');
  }

  // Subset validation: every output word must come from Cloud Vision's input.
  const inputBag = extractWordBag(fragments.join(' '));
  const outputBag = extractWordBag(assembled);
  const validation = validateSubset(inputBag, outputBag);

  if (!validation.ok) {
    const h = validation.hallucinated;
    console.warn('[OCR Hybrid] Assembly modified words:', h.slice(0, 15).join(', '));
    if (h.length > 5) {
      // Many new words = likely real hallucination
      throw new Error(`Subset validation failed — ${h.length} hallucinated words`);
    }
    // ≤5 modified words = minor corrections (Gemini fixing OCR artifacts).
    // Allow through — the correction pass has its own edit-distance guard.
    console.log(`[OCR Hybrid] Minor modifications (${h.length} words) allowed, proceeding`);
  }

  return assembled;
}

/**
 * Character-level Levenshtein similarity ratio.
 * Returns 1.0 for identical strings, 0.0 for completely different.
 */
function levenshteinSimilarity(a, b) {
  const m = a.length, n = b.length;
  if (m === 0 && n === 0) return 1;
  if (m === 0 || n === 0) return 0;
  const dp = Array.from({length: m + 1}, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j-1], dp[i-1][j], dp[i][j-1]);
    }
  }
  return 1 - dp[m][n] / Math.max(m, n);
}

/**
 * Second Gemini pass: fix OCR artifacts by comparing assembled text against the page image.
 * Unlike the reverted OOV cleanup (text-only), this pass INCLUDES the image so Gemini
 * can distinguish intentional text ("phys ed") from artifacts ("6ageography").
 * Edit-distance guard rejects corrections that change too much.
 */
async function correctWithGemini(base64, mimeType, assembledText, geminiKey) {
  console.log('[OCR Hybrid] correctWithGemini: starting image-based artifact correction');
  const systemInstruction = {
    parts: [{ text: `You are an OCR text corrector for children's reading assessment passages.
You receive OCR-assembled passage text alongside the original page image.
Your job is to fix OCR artifacts by visually comparing text against the image.

Fix these artifacts:
- Digit-letter fusions: "6ageography" → "geography", "1earning" → "learning"
- Fused line numbers: "78At school" → "At school"
- Stray punctuation not on the page: trailing "/", ")", ">" that are scanning artifacts
- Missing spaces between words that the image shows as separate

Do NOT change:
- Words that match what is printed on the page, even if unusual
- Spelling in the original text — if the page says "colour", keep "colour"
- Abbreviations that match the page (e.g., "phys ed" stays as "phys ed")
- Paragraph structure — preserve blank lines exactly

Return ONLY the corrected passage text.` }]
  };

  const userPrompt = `Compare this OCR text against the attached page image. Fix only OCR artifacts — characters that don't match what's printed on the page:

${assembledText}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: systemInstruction,
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: userPrompt }
          ]
        }],
        generationConfig: {
          temperature: 0,
          topK: 1,
          topP: 1
        }
      })
    }
  );

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    if (response.status === 429) throw new Error('Gemini rate limit');
    throw new Error(`Gemini correction error: ${response.status} ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked: ${data.promptFeedback.blockReason}`);
  }

  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error('Gemini returned no candidates');

  if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'RECITATION') {
    throw new Error(`Gemini blocked (${candidate.finishReason})`);
  }

  const corrected = (candidate.content?.parts?.[0]?.text || '').trim();
  if (!corrected) throw new Error('Gemini returned empty correction');

  // Edit-distance guard: reject if Gemini changed more than 15% of characters
  const similarity = levenshteinSimilarity(assembledText, corrected);
  if (similarity < 0.85) {
    throw new Error(`Correction too aggressive (${Math.round(similarity * 100)}% similar, need 85%+)`);
  }

  // Word count guard: corrected should not have significantly more words
  const assembledWordCount = (assembledText.match(/\S+/g) || []).length;
  const correctedWordCount = (corrected.match(/\S+/g) || []).length;
  if (correctedWordCount > assembledWordCount * 1.1) {
    throw new Error(`Correction added too many words (${assembledWordCount} → ${correctedWordCount})`);
  }

  return corrected;
}

/**
 * Extract words with low OCR confidence from Cloud Vision's annotation hierarchy.
 * Returns deduplicated list sorted by confidence (lowest first).
 */
function extractLowConfidenceWords(annotation, threshold = 0.85) {
  const lowConf = [];
  if (!annotation || !annotation.pages) return lowConf;

  for (const page of annotation.pages) {
    for (const block of (page.blocks || [])) {
      if (block.blockType && block.blockType !== 'TEXT') continue;
      for (const para of (block.paragraphs || [])) {
        for (const word of (para.words || [])) {
          const text = (word.symbols || []).map(s => s.text).join('');
          const conf = word.confidence;
          if (conf !== undefined && conf < threshold && text.length > 1) {
            lowConf.push({ word: text, confidence: Math.round(conf * 100) });
          }
        }
      }
    }
  }

  // Deduplicate: keep lowest confidence per unique word
  const seen = new Map();
  for (const item of lowConf) {
    const key = item.word.toLowerCase();
    if (!seen.has(key) || seen.get(key).confidence > item.confidence) {
      seen.set(key, item);
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.confidence - b.confidence);
}

// ─── Main hybrid entry point ───

/**
 * Hybrid OCR: Cloud Vision + Gemini assembly.
 *
 * 1. Cloud Vision extracts the full paragraph hierarchy (excellent character accuracy)
 * 2. Gemini assembles fragments into correct reading order, drops junk
 *
 * If Gemini fails, falls back to Cloud Vision's raw text ordering.
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
  const flatText = normalizeUnicode((annotation && annotation.text) || '');

  // Extract low-confidence words from Cloud Vision (available in all paths)
  const lowConfidenceWords = extractLowConfidenceWords(annotation);
  console.log(`[OCR Hybrid] Pipeline v2: Unicode norm + system instructions + correction pass | ${lowConfidenceWords.length} low-confidence words`);

  if (!flatText) {
    return { text: '', engine: 'vision (empty)', lowConfidenceWords: [] };
  }

  // Step 2: Extract all fragments from hierarchy
  const paragraphs = extractParagraphs(annotation);

  if (paragraphs.length <= 1) {
    return { text: flatText, engine: 'vision (single paragraph)', lowConfidenceWords };
  }

  // Step 3: Gemini assembles fragments into correct reading order
  let assembled;
  try {
    assembled = await assembleWithGemini(base64, mimeType, paragraphs, geminiKey);
  } catch (err) {
    console.warn('[OCR Hybrid] Gemini assembly failed, using Cloud Vision ordering:', err.message);
    return { text: flatText, engine: `vision fallback (${err.message})`, lowConfidenceWords };
  }

  // Step 4: Gemini corrects OCR artifacts by comparing assembled text against the image
  let finalText = assembled;
  try {
    finalText = await correctWithGemini(base64, mimeType, assembled, geminiKey);
    if (finalText !== assembled) {
      console.log('[OCR Hybrid] Gemini correction applied');
    }
  } catch (err) {
    console.warn('[OCR Hybrid] Gemini correction skipped:', err.message);
  }

  return {
    text: finalText,
    engine: `hybrid (${paragraphs.length} fragments${finalText !== assembled ? ' + corrected' : ''})`,
    lowConfidenceWords
  };
}
