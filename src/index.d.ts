import * as React from "react";

/**
 * The image to load into the editor. Accepts a remote/static URL, a File
 * (e.g. from an <input type="file">), a Blob, or an already-encoded data
 * URL. Object URLs created internally for "file"/"blob" sources are
 * automatically revoked when the source changes or the modal unmounts.
 */
export type EditableImageSource =
  | { kind: "url"; url: string; name?: string }
  | { kind: "file"; file: File; name?: string }
  | { kind: "blob"; blob: Blob; name?: string }
  | { kind: "dataUrl"; dataUrl: string; name?: string };

/**
 * The result handed to `onSave` once the user confirms their edit.
 *
 * `blob` and `file` are the same bytes in two wrappers; use whichever your
 * upload pipeline needs. `dataUrl` is **not** produced by default — encoding
 * a full-resolution canvas to base64 is a synchronous, multi-megabyte,
 * main-thread operation. Ask for it explicitly with `includeDataUrl: true`
 * when calling `buildImageEditResult` yourself.
 */
export interface ImageEditResult {
  blob: Blob;
  file: File;
  /** Only present when built with `includeDataUrl: true`. */
  dataUrl: string | undefined;
  width: number;
  height: number;
}

export interface ImageEditorModalProps {
  /** Controls whether the modal is rendered/visible. */
  isOpen: boolean;
  /** Called when the user cancels/dismisses the editor without saving. */
  onClose: () => void;
  /** The image to edit. See {@link EditableImageSource}. */
  image: EditableImageSource;
  /**
   * Called with the edited image once the user confirms save/send.
   *
   * If it returns a promise, the editor keeps its save spinner up and the
   * confirm button disabled until that promise settles — so your own upload
   * is covered by the same double-tap guard as the export itself.
   */
  onSave: (result: ImageEditResult) => void | Promise<void>;
}

/**
 * A portable, WhatsApp-style image editor modal — crop, freehand drawing,
 * shapes (rectangle / ellipse / arrow / double-arrow / curve), and text
 * overlays, with a dedicated mobile UI and a desktop sidebar UI.
 *
 * Canvases are backed at the device pixel ratio (capped at 3x) while all
 * editor code works in logical pixels, and Save/Download re-render the photo
 * from the original decode at up to its native resolution — so exports are
 * not limited to the on-screen preview size.
 *
 * While open, the modal locks background scrolling and traps the browser's
 * back gesture (via a throwaway `history.pushState` entry) so an edge swipe
 * cannot navigate the underlying page away mid-edit. Both are undone on close.
 *
 * This component reads `window`/`document` on mount and must not be
 * server-rendered. In Next.js, import it with:
 *
 * ```ts
 * const ImageEditorModal = dynamic(
 *   () => import("@yourscope/react-image-editor").then((m) => m.ImageEditorModal),
 *   { ssr: false },
 * );
 * ```
 */
export declare function ImageEditorModal(
  props: ImageEditorModalProps,
): React.JSX.Element | null;

/**
 * Normalizes any {@link EditableImageSource} into a usable <img>/canvas src.
 * Returns a `cleanup()` you must call (e.g. from a `useEffect` return) to
 * revoke any object URL created for "file"/"blob" sources. Called
 * internally by `ImageEditorModal`; exported for advanced/custom usage.
 */
export declare function resolveImageSource(
  source: EditableImageSource | null | undefined,
): {
  src: string | null;
  name: string | undefined;
  isObjectUrl: boolean;
  cleanup: () => void;
};

/**
 * Produces a stable string key for an {@link EditableImageSource}, suitable
 * for use as a `useEffect`/`useMemo` dependency array entry — avoids
 * re-resolving (and re-revoking) object URLs just because a caller passed a
 * fresh object literal with the same underlying value.
 */
export declare function getImageSourceKey(
  source: EditableImageSource | null | undefined,
): string | null;

/** Default export encoding used by the editor's Save and Download. */
export declare const EXPORT_MIME_TYPE: string;
/** Default export quality (0-1) used for the lossy {@link EXPORT_MIME_TYPE}. */
export declare const EXPORT_QUALITY: number;

/**
 * The file extension for an encoded blob's *actual* MIME type.
 *
 * Always derive the extension from `blob.type`, never from the type you
 * requested: `canvas.toBlob()` silently falls back to PNG when it cannot
 * encode the requested format, and a PNG payload named ".webp" will not open
 * everywhere.
 */
export declare function extensionForMimeType(mimeType: string | undefined): string;

/**
 * Builds the output file name for an edited image: strips any URL path and
 * query, replaces the source extension, and applies an "edited-" prefix
 * without stacking it on re-edits.
 *
 * ```ts
 * buildEditedFileName("a/b/scan.jpeg?v=2", "jpg"); // "edited-scan.jpg"
 * ```
 */
export declare function buildEditedFileName(
  name: string | undefined | null,
  extension?: string,
): string;

/**
 * Builds an {@link ImageEditResult} from a canvas. Called internally by
 * `ImageEditorModal`'s save flow; exported for advanced/custom usage.
 */
export declare function buildImageEditResult(
  canvas: HTMLCanvasElement,
  options?: {
    /** Defaults to "edited-image.jpg" */
    fileName?: string;
    /** Defaults to {@link EXPORT_MIME_TYPE} */
    mimeType?: string;
    /** Defaults to {@link EXPORT_QUALITY}; only used for lossy mime types. */
    quality?: number;
    /**
     * Also produce a base64 `dataUrl`. Off by default: it is a synchronous
     * main-thread encode of several megabytes on a full-resolution canvas.
     */
    includeDataUrl?: boolean;
  },
): Promise<ImageEditResult>;
