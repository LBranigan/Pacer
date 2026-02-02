/**
 * OCR API module — Google Vision text extraction from images.
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

  return (result && result.fullTextAnnotation && result.fullTextAnnotation.text) || '';
}
