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
 * The result handed to `onSave` once the user confirms their edit. All four
 * representations are derived from the same flattened canvas in a single
 * pass — use whichever your upload pipeline needs.
 */
export interface ImageEditResult {
  blob: Blob;
  file: File;
  dataUrl: string;
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
  /** Called with the edited image once the user confirms save/send. */
  onSave: (result: ImageEditResult) => void;
}

/**
 * A portable, WhatsApp-style image editor modal — crop, freehand drawing,
 * shapes (rectangle / circle / arrow / double-arrow / curve), and text
 * overlays, with a dedicated mobile UI and a desktop sidebar UI.
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

/**
 * Builds an {@link ImageEditResult} from a canvas — blob, File, dataUrl, and
 * dimensions, all derived from a single `canvas.toBlob()` call. Called
 * internally by `ImageEditorModal`'s save flow; exported for advanced/
 * custom usage.
 */
export declare function buildImageEditResult(
  canvas: HTMLCanvasElement,
  options?: {
    /** Defaults to "edited-image.png" */
    fileName?: string;
    /** Defaults to "image/png" */
    mimeType?: string;
    /** Only used for lossy mime types (e.g. "image/jpeg") */
    quality?: number;
  },
): Promise<ImageEditResult>;