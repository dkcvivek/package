/**
 * @typedef {{
 *   blob: Blob,
 *   file: File,
 *   dataUrl: string,
 *   width: number,
 *   height: number,
 * }} ImageEditResult
 */

/**
 * Builds an ImageEditResult from a canvas at save time.
 *
 * Uses canvas.toBlob() (async, non-blocking) for the Blob/File and
 * canvas.toDataURL() for the dataUrl convenience field, since callers that
 * only need one form shouldn't have to await a FileReader round-trip.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} [options]
 * @param {string} [options.fileName] - defaults to "edited-image.png"
 * @param {string} [options.mimeType] - defaults to "image/png"
 * @param {number} [options.quality] - only used for lossy mime types (e.g. image/jpeg)
 * @returns {Promise<ImageEditResult>}
 */
export function buildImageEditResult(canvas, options = {}) {
  const {
    fileName = "edited-image.png",
    mimeType = "image/png",
    quality,
  } = options;

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("buildImageEditResult: canvas.toBlob() returned null"));
          return;
        }
        const file = new File([blob], fileName, { type: mimeType });
        const dataUrl = canvas.toDataURL(mimeType, quality);
        resolve({
          blob,
          file,
          dataUrl,
          width: canvas.width,
          height: canvas.height,
        });
      },
      mimeType,
      quality,
    );
  });
}
