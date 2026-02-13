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
 * Uses block bounding boxes to detect multi-column layouts and
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
// Layout-aware text extraction
// ---------------------------------------------------------------------------

/** Bounding-box helper: get {left, top, right, bottom} from Vision vertices. */
function bbox(boundingBox) {
  const v = boundingBox.vertices;
  return {
    left:   Math.min(v[0].x || 0, v[3].x || 0),
    top:    Math.min(v[0].y || 0, v[1].y || 0),
    right:  Math.max(v[1].x || 0, v[2].x || 0),
    bottom: Math.max(v[2].y || 0, v[3].y || 0)
  };
}

/** Extract space-separated word text from a Vision paragraph object. */
function paraToText(para) {
  return (para.words || []).map(w =>
    (w.symbols || []).map(s => s.text).join('')
  ).join(' ');
}

/** Extract text from a Vision block (one string per paragraph, joined by newline). */
function blockToText(block) {
  // Sort paragraphs top-to-bottom within the block (Vision may miscode order)
  const paras = [...(block.paragraphs || [])];
  paras.sort((a, b) => bbox(a.boundingBox).top - bbox(b.boundingBox).top);
  return paras.map(paraToText).join('\n');
}

/**
 * Main layout-aware extractor. Processes the fullTextAnnotation hierarchy
 * using block bounding boxes to detect columns and sort reading order.
 */
function extractWithLayoutAwareness(annotation) {
  const page = annotation.pages && annotation.pages[0];
  if (!page || !page.blocks || page.blocks.length === 0) {
    return annotation.text || '';
  }

  const textBlocks = page.blocks.filter(b => !b.blockType || b.blockType === 'TEXT');
  if (textBlocks.length === 0) return annotation.text || '';

  // Compute bounding info for each block
  const blockInfos = textBlocks.map(block => ({ block, ...bbox(block.boundingBox) }));

  // Page dimensions (explicit from API, or inferred from block extents)
  const pageW = page.width  || (Math.max(...blockInfos.map(b => b.right))  - Math.min(...blockInfos.map(b => b.left)));
  const pageH = page.height || (Math.max(...blockInfos.map(b => b.bottom)) - Math.min(...blockInfos.map(b => b.top)));

  // Filter noise: headers, footers, page numbers, margin annotations
  const body = filterNonBodyBlocks(blockInfos, pageW, pageH);
  const blocks = body.length > 0 ? body : blockInfos;

  // Detect columns from block left-edge clustering
  const columns = detectColumns(blocks, pageW);

  if (columns.length <= 1) {
    // Single column — sort top-to-bottom
    blocks.sort((a, b) => a.top - b.top);
    return blocks.map(bi => blockToText(bi.block)).join('\n');
  }

  // Multi-column: split any block that spans across the column boundary
  const boundary = computeColumnBoundary(columns);
  const fragments = buildFragments(blocks, boundary, pageW);

  // Assign fragments to columns by center-x relative to boundary
  const leftCol = [];
  const rightCol = [];
  for (const f of fragments) {
    const cx = (f.left + f.right) / 2;
    (cx < boundary ? leftCol : rightCol).push(f);
  }

  // Sort each column top-to-bottom, concatenate left then right
  leftCol.sort((a, b) => a.top - b.top);
  rightCol.sort((a, b) => a.top - b.top);

  const leftText  = leftCol.map(f => f.text).join('\n');
  const rightText = rightCol.map(f => f.text).join('\n');
  return (leftText + '\n' + rightText).trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Filter blocks that are likely headers, footers, page numbers, or
 * margin annotations (line numbers like "78", "117" in textbook margins).
 */
function filterNonBodyBlocks(blockInfos, pageW, pageH) {
  return blockInfos.filter(bi => {
    const blockW = bi.right - bi.left;
    const blockH = bi.bottom - bi.top;
    // Skip tiny blocks in outer margins (page numbers, line numbers)
    if (blockW < pageW * 0.08 && blockH < pageH * 0.04) return false;
    // Skip blocks in top/bottom 6% (headers/footers/page numbers)
    if (bi.bottom < pageH * 0.06) return false;
    if (bi.top > pageH * 0.94) return false;
    return true;
  });
}

/**
 * Detect columns by clustering block left-edge x-coordinates.
 * Returns array of column groups (each group is an array of blockInfos).
 * A gap > 15% of page width between sorted left-edges signals a column break.
 */
function detectColumns(blockInfos, pageW) {
  if (blockInfos.length < 2) return [blockInfos];

  // Sort by left edge
  const sorted = [...blockInfos].sort((a, b) => a.left - b.left);
  const threshold = pageW * 0.15;

  const columns = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    // Compare to the average left-edge of the current column cluster
    const curCol = columns[columns.length - 1];
    const avgLeft = curCol.reduce((s, b) => s + b.left, 0) / curCol.length;
    if (sorted[i].left - avgLeft > threshold) {
      columns.push([sorted[i]]);
    } else {
      curCol.push(sorted[i]);
    }
  }
  return columns;
}

/**
 * Given detected column groups, compute the x-coordinate that separates them.
 * Uses the midpoint between the rightmost edge of the left cluster and
 * the leftmost edge of the right cluster.
 */
function computeColumnBoundary(columns) {
  // Sort column groups left-to-right by average left-edge
  const sorted = [...columns].sort((a, b) => {
    const avgA = a.reduce((s, bi) => s + bi.left, 0) / a.length;
    const avgB = b.reduce((s, bi) => s + bi.left, 0) / b.length;
    return avgA - avgB;
  });
  // Boundary = midpoint between right edge of left-column and left edge of right-column
  const leftColRight = Math.max(...sorted[0].map(b => b.right));
  const rightColLeft = Math.min(...sorted[1].map(b => b.left));
  return (leftColRight + rightColLeft) / 2;
}

/**
 * Convert blocks into text fragments, splitting any "merged" block
 * (one that spans across the column boundary) at the word level.
 * Returns array of { left, top, right, bottom, text } fragments.
 */
function buildFragments(blockInfos, boundary, pageW) {
  const fragments = [];

  for (const bi of blockInfos) {
    const blockW = bi.right - bi.left;
    const spansBoundary = bi.left < boundary && bi.right > boundary && blockW > pageW * 0.55;

    if (!spansBoundary) {
      // Normal block — one fragment per paragraph
      const paras = [...(bi.block.paragraphs || [])];
      paras.sort((a, b) => bbox(a.boundingBox).top - bbox(b.boundingBox).top);
      for (const para of paras) {
        const pb = bbox(para.boundingBox);
        fragments.push({ ...pb, text: paraToText(para) });
      }
      continue;
    }

    // Merged block — split words into left vs right groups by x-coordinate
    for (const para of (bi.block.paragraphs || [])) {
      const leftWords = [];
      const rightWords = [];
      for (const word of (para.words || [])) {
        const wb = bbox(word.boundingBox);
        const cx = (wb.left + wb.right) / 2;
        const wordText = (word.symbols || []).map(s => s.text).join('');
        const entry = { text: wordText, top: wb.top, left: wb.left, right: wb.right, bottom: wb.bottom };
        (cx < boundary ? leftWords : rightWords).push(entry);
      }
      // Build a fragment for each side that has words
      for (const group of [leftWords, rightWords]) {
        if (group.length === 0) continue;
        group.sort((a, b) => a.top - b.top || a.left - b.left);
        // Group words into lines by y-proximity, then join
        const lines = groupWordsIntoLines(group);
        const text = lines.map(line =>
          line.sort((a, b) => a.left - b.left).map(w => w.text).join(' ')
        ).join('\n');
        fragments.push({
          left:   Math.min(...group.map(w => w.left)),
          top:    Math.min(...group.map(w => w.top)),
          right:  Math.max(...group.map(w => w.right)),
          bottom: Math.max(...group.map(w => w.bottom)),
          text
        });
      }
    }
  }

  return fragments;
}

/**
 * Group words into lines based on y-coordinate proximity.
 * Words whose tops are within half the median word height are on the same line.
 */
function groupWordsIntoLines(words) {
  if (words.length === 0) return [];
  const heights = words.map(w => w.bottom - w.top).filter(h => h > 0);
  const medH = heights.length > 0 ? heights.sort((a, b) => a - b)[Math.floor(heights.length / 2)] : 20;
  const threshold = medH * 0.5;

  const sorted = [...words].sort((a, b) => a.top - b.top);
  const lines = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const lastLine = lines[lines.length - 1];
    const lastTop = lastLine[0].top;
    if (Math.abs(sorted[i].top - lastTop) <= threshold) {
      lastLine.push(sorted[i]);
    } else {
      lines.push([sorted[i]]);
    }
  }
  return lines;
}
