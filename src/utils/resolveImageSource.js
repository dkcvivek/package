/**
 * @typedef {
 *   | { kind: "url", url: string, name?: string }
 *   | { kind: "file", file: File, name?: string }
 *   | { kind: "blob", blob: Blob, name?: string }
 *   | { kind: "dataUrl", dataUrl: string, name?: string }
 * } EditableImageSource
 */

/**
 * Normalizes any EditableImageSource into something an <img>/canvas can load.
 *
 * - "url"     -> passed through as-is (consumer's own remote/static URL)
 * - "dataUrl" -> passed through as-is (already a usable src)
 * - "file"    -> wrapped in an object URL (must be revoked when done)
 * - "blob"    -> wrapped in an object URL (must be revoked when done)
 *
 * @param {EditableImageSource | null | undefined} source
 * @returns {{ src: string | null, name: string | undefined, isObjectUrl: boolean, cleanup: () => void }}
 */
export function resolveImageSource(source) {
  const noop = () => {};

  if (!source) {
    return { src: null, name: undefined, isObjectUrl: false, cleanup: noop };
  }

  switch (source.kind) {
    case "url":
      if (!source.url) {
        throw new Error('resolveImageSource: "url" source is missing `url`');
      }
      return {
        src: source.url,
        name: source.name,
        isObjectUrl: false,
        cleanup: noop,
      };

    case "dataUrl":
      if (!source.dataUrl) {
        throw new Error(
          'resolveImageSource: "dataUrl" source is missing `dataUrl`',
        );
      }
      return {
        src: source.dataUrl,
        name: source.name,
        isObjectUrl: false,
        cleanup: noop,
      };

    case "file": {
      if (!source.file) {
        throw new Error('resolveImageSource: "file" source is missing `file`');
      }
      const objectUrl = URL.createObjectURL(source.file);
      return {
        src: objectUrl,
        name: source.name || source.file.name,
        isObjectUrl: true,
        cleanup: () => URL.revokeObjectURL(objectUrl),
      };
    }

    case "blob": {
      if (!source.blob) {
        throw new Error('resolveImageSource: "blob" source is missing `blob`');
      }
      const objectUrl = URL.createObjectURL(source.blob);
      return {
        src: objectUrl,
        name: source.name,
        isObjectUrl: true,
        cleanup: () => URL.revokeObjectURL(objectUrl),
      };
    }

    default:
      throw new Error(
        `resolveImageSource: unknown source kind "${source?.kind}". ` +
          'Expected one of "url" | "file" | "blob" | "dataUrl".',
      );
  }
}

/**
 * Produces a stable, comparable key for an EditableImageSource so callers can
 * use it as a `useEffect`/`useMemo` dependency without re-resolving (and
 * re-revoking) object URLs on every render just because a consumer passed a
 * fresh object literal.
 *
 * @param {EditableImageSource | null | undefined} source
 * @returns {string | null}
 */
export function getImageSourceKey(source) {
  if (!source) return null;
  switch (source.kind) {
    case "url":
      return `url:${source.url}`;
    case "dataUrl":
      // dataUrls can be long; length + a slice is enough to detect changes
      // without hashing the whole thing on every render.
      return `dataUrl:${source.dataUrl.length}:${source.dataUrl.slice(0, 64)}`;
    case "file":
      return `file:${source.file.name}:${source.file.size}:${source.file.lastModified}`;
    case "blob":
      return `blob:${source.blob.size}:${source.blob.type}`;
    default:
      return `unknown:${String(source.kind)}`;
  }
}