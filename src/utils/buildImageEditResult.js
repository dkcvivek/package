/**
 * @typedef {{
 *   blob: Blob,
 *   file: File,
 *   dataUrl: string | undefined,
 *   width: number,
 *   height: number,
 * }} ImageEditResult
 *
 * `dataUrl` is only populated when `buildImageEditResult` is called with
 * `includeDataUrl: true` — see the note on that option.
 */

/**
 * Default encoding used for exports (Save and Download).
 *
 * JPEG at 0.85 rather than PNG. The editor exports at up to the photo's native
 * resolution, and a full-resolution PNG of a phone photo runs 15-30 MB — too
 * heavy to upload over a slow connection, and slow enough to encode that it
 * visibly blocks the main thread on a mid-range phone. The same picture is
 * ~300 KB as JPEG.
 *
 * Transparency is not a concern: the canvas IS the photo, edge to edge, with
 * no letterbox margin, so nothing exported is transparent — and the editor's
 * export path paints an opaque backdrop anyway.
 *
 * Callers who need lossless output can override both per call:
 *   buildImageEditResult(canvas, { mimeType: "image/png", quality: undefined })
 */
export const EXPORT_MIME_TYPE = "image/jpeg";
export const EXPORT_QUALITY = 0.85;

/**
 * File extension for an encoded blob's actual MIME type.
 *
 * Always derive this from `blob.type`, never from what you *asked* for:
 * `canvas.toBlob()` is specified to fall back to `image/png` when it cannot
 * encode the requested type (iOS Safari before 16 cannot do WebP), and it does
 * so silently. Naming that PNG payload ".webp" would produce a file some
 * viewers refuse to open.
 *
 * @param {string | undefined} mimeType
 * @returns {string}
 */
export function extensionForMimeType(mimeType) {
  switch (String(mimeType || "").toLowerCase()) {
    case "image/webp":
      return "webp";
    case "image/jpeg":
      return "jpg";
    default:
      return "png";
  }
}

/**
 * Builds the output file name for an edited image.
 *
 * The export extension rarely matches the source's, so the source extension
 * has to go first — naively appending ".jpg" to the original name produced
 * "photo.png.jpg".
 * Also tolerates names that arrived as a URL (path segments, query string) and
 * avoids stacking the prefix when re-editing an already-edited image.
 *
 *   "photo.jpg"                  -> "edited-photo.png"
 *   "IMG_1234"                   -> "edited-IMG_1234.png"
 *   "a/b/scan.jpeg?v=2"          -> "edited-scan.png"
 *   "edited-photo.png"           -> "edited-photo.png"
 *   undefined                    -> "edited-image.png"
 *
 * @param {string | undefined | null} name - the source image's name
 * @param {string} [extension="png"] - pass `extensionForMimeType(blob.type)`
 * @returns {string}
 */
export function buildEditedFileName(name, extension = "png") {
  const raw = String(name ?? "").trim();
  const lastSegment = raw.split(/[\\/]/).pop() || "";
  const withoutQuery = lastSegment.split(/[?#]/)[0];
  const stem = withoutQuery.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim();
  const safe = stem || "image";
  const prefixed = safe.startsWith("edited-") ? safe : `edited-${safe}`;
  return `${prefixed}.${extension}`;
}

/**
 * Builds an ImageEditResult from a canvas at save time.
 *
 * Uses canvas.toBlob() (async, non-blocking) for the Blob/File.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} [options]
 * @param {string}  [options.fileName] - defaults to "edited-image.jpg"
 * @param {string}  [options.mimeType] - defaults to EXPORT_MIME_TYPE
 * @param {number}  [options.quality] - only used for lossy types (webp, jpeg)
 * @param {boolean} [options.includeDataUrl=false] - also produce a base64
 *   data URL. Off by default: it is a synchronous main-thread encode of several
 *   megabytes on a full-resolution HiDPI canvas.
 * @returns {Promise<ImageEditResult>}
 */
export function buildImageEditResult(canvas, options = {}) {
  const {
    fileName = "edited-image.jpg",
    // Default to the module's own constant rather than hardcoding a type here.
    // These used to disagree: Download read EXPORT_MIME_TYPE while Save fell
    // through to a hardcoded "image/png", so changing the format only moved
    // one of the two export paths.
    mimeType = EXPORT_MIME_TYPE,
    quality = EXPORT_QUALITY,
    includeDataUrl = false,
  } = options;

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(
            new Error("buildImageEditResult: canvas.toBlob() returned null"),
          );
          return;
        }
        // Name the File from the type we actually got — toBlob falls back to
        // PNG when it cannot encode the requested type.
        const file = new File([blob], fileName, { type: blob.type || mimeType });

        // `dataUrl` is opt-in. It used to be built unconditionally, but
        // toDataURL on a full-resolution HiDPI canvas is a synchronous,
        // main-thread encode that produces several megabytes of base64 string —
        // and the only caller never read the field. Ask for it if you need it.
        const dataUrl = includeDataUrl
          ? canvas.toDataURL(blob.type || mimeType, quality)
          : undefined;

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
