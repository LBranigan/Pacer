/**
 * OCR API module — Google Vision text extraction with layout-aware
 * column detection and reading-order reconstruction.
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

/**
 * Extract text from an image using Google Vision OCR.
 * Uses paragraph bounding boxes to detect multi-column layouts and
 * reconstruct correct reading order (left column first, then right).
 * @param {File} file - Image file
 * @param {string} apiKey - Google Cloud API key with Vision API enabled
 * @returns {Promise<string>} Extracted text
 */
export async function extractTextFromImage(file, apiKey) {
  const resized = await resizeImageIfNeeded(file);

  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      resolve(dataUrl.split(',')[1]);
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(resized);
  });

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

  const annotation = result && result.fullTextAnnotation;
  if (!annotation) return '';

  try {
    return extractWithLayoutAwareness(annotation);
  } catch (e) {
    console.warn('Layout-aware extraction failed, falling back to raw text:', e);
    return annotation.text || '';
  }
}

// ---------------------------------------------------------------------------
// Layout-aware text extraction (paragraph-level)
// ---------------------------------------------------------------------------

/** Get {left, top, right, bottom} from Vision BoundingPoly vertices. */
function bbox(boundingBox) {
  const v = boundingBox.vertices;
  return {
    left:   Math.min(v[0].x || 0, v[3].x || 0),
    top:    Math.min(v[0].y || 0, v[1].y || 0),
    right:  Math.max(v[1].x || 0, v[2].x || 0),
    bottom: Math.max(v[2].y || 0, v[3].y || 0)
  };
}

/** Extract space-separated word text from a Vision paragraph. */
function paraToText(para) {
  return (para.words || []).map(w =>
    (w.symbols || []).map(s => s.text).join('')
  ).join(' ');
}

/**
 * Flatten the Vision hierarchy to paragraph-level items with bounding boxes.
 * This is the "normalization" step: we discard block groupings (which may
 * merge text from different visual regions) and work with individual
 * paragraphs whose bounding boxes reliably reflect their position on page.
 */
function flattenToParagraphs(page) {
  const items = [];
  for (const block of (page.blocks || [])) {
    if (block.blockType && block.blockType !== 'TEXT') continue;
    for (const para of (block.paragraphs || [])) {
      if (!para.boundingBox) continue;
      const b = bbox(para.boundingBox);
      const text = paraToText(para);
      if (!text.trim()) continue;
      items.push({ ...b, text });
    }
  }
  return items;
}

/**
 * Main extractor. Works at paragraph level for correct granularity:
 * - Too coarse (block-level) can't fix within-block misordering
 * - Too fine (word-level) fragments sentences
 * - Paragraph-level: each paragraph stays intact, gets sorted into columns
 */
function extractWithLayoutAwareness(annotation) {
  const page = annotation.pages && annotation.pages[0];
  if (!page || !page.blocks || page.blocks.length === 0) {
    return annotation.text || '';
  }

  const paragraphs = flattenToParagraphs(page);
  if (paragraphs.length === 0) return annotation.text || '';

  // Page width: explicit from API or inferred from paragraph extents
  const pageW = page.width ||
    (Math.max(...paragraphs.map(p => p.right)) - Math.min(...paragraphs.map(p => p.left)));

  // Separate full-width paragraphs (titles, subtitles, single-column body)
  // from narrow paragraphs that may form columns
  const fullWidth = [];
  const narrow = [];
  for (const p of paragraphs) {
    if ((p.right - p.left) > pageW * 0.6) {
      fullWidth.push(p);
    } else {
      narrow.push(p);
    }
  }

  // Detect columns from narrow paragraphs only
  const columns = detectColumns(narrow, pageW);

  // Require 2+ columns with 2+ paragraphs each — otherwise not multi-column
  const substantial = columns.filter(c => c.length >= 2);
  if (substantial.length < 2) {
    // Single-column (or uncertain): sort everything top-to-bottom
    paragraphs.sort((a, b) => a.top - b.top);
    return paragraphs.map(p => p.text).join('\n');
  }

  // Sort column groups left-to-right
  substantial.sort((a, b) => {
    const avgA = a.reduce((s, p) => s + p.left, 0) / a.length;
    const avgB = b.reduce((s, p) => s + p.left, 0) / b.length;
    return avgA - avgB;
  });

  // Sort within each group by y-position
  fullWidth.sort((a, b) => a.top - b.top);
  for (const col of substantial) {
    col.sort((a, b) => a.top - b.top);
  }

  // Collect stray narrow paragraphs (in small columns that didn't meet threshold)
  const assignedSet = new Set(substantial.flat());
  const stray = narrow.filter(p => !assignedSet.has(p));
  stray.sort((a, b) => a.top - b.top);

  // Combine: full-width → each column left-to-right → stray
  const parts = [
    ...fullWidth.map(p => p.text),
    ...substantial.flatMap(col => col.map(p => p.text)),
    ...stray.map(p => p.text)
  ];

  return parts.join('\n').trim();
}

/**
 * Cluster paragraphs into columns by left-edge x-coordinate proximity.
 * Gap > 15% of page width between clusters signals a column boundary.
 */
function detectColumns(items, pageW) {
  if (items.length < 2) return [items];

  const sorted = [...items].sort((a, b) => a.left - b.left);
  const threshold = pageW * 0.15;

  const columns = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const curCol = columns[columns.length - 1];
    const avgLeft = curCol.reduce((s, p) => s + p.left, 0) / curCol.length;
    if (sorted[i].left - avgLeft > threshold) {
      columns.push([sorted[i]]);
    } else {
      curCol.push(sorted[i]);
    }
  }
  return columns;
}
