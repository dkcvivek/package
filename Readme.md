# @vivekjha659/react-image-editor

A portable, WhatsApp-style image editor modal for React and Next.js apps —
crop, freehand drawing, shapes (rectangle / ellipse / arrow / double-arrow /
curve), and text overlays. Ships with a dedicated mobile UI and a separate
desktop sidebar UI.

Canvases are backed at the device pixel ratio (capped at 3×) so the photo
renders sharp on phones, and Save/Download re-render from the original decode
at up to the photo's native resolution — exports are not limited to the
on-screen preview size.

## Install

```bash
npm install @vivekjha659/react-image-editor
```

You'll also need these peer dependencies if your project doesn't already
have them:

```bash
npm install react react-dom react-konva konva lucide-react react-icons react-toastify
```

Import the stylesheet once, anywhere in your app (it's plain compiled CSS —
no Tailwind setup required on your end, even if you don't use Tailwind):

```js
import "@vivekjha659/react-image-editor/style.css";
```

### Styling — it won't fight your app's CSS

The stylesheet is built to coexist with whatever your app already has:
Tailwind v3 or v4, Bootstrap, a hand-written reset, or a global
`button { border: 1px solid … }` rule.

- **Nothing leaks out.** Every rule is scoped under `#image-editor-modal`
  and every class is prefixed `rie-`. There is no global reset — your
  page's buttons, headings and lists are untouched.
- **Nothing leaks in.** All rules carry id-level specificity, so a host
  rule like `button { … }` or `.card button { … }` cannot restyle the
  editor. Only a host selector that itself uses an id, or `!important`,
  can override it — which is then a deliberate choice on your part.
- **No Tailwind needed.** The editor carries its own copy of the CSS
  variable defaults Tailwind utilities rely on, so transforms, rings and
  shadows render correctly in apps with no Tailwind at all.

To deliberately restyle something, match that specificity:

```css
#image-editor-modal .rie-bg-black { background: #111; }
```

### Toasts

The editor reports its own feedback ("Filter applied", "Save failed", …)
through `react-toastify`'s `toast()`. Rendering the container is your job —
the package deliberately doesn't, so you keep control of where toasts
appear. Without it, that feedback silently goes nowhere:

```jsx
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

<ToastContainer position="top-center" autoClose={2500} />
```

## Quick start

```jsx
import { useState } from "react";
import { ImageEditorModal } from "@vivekjha659/react-image-editor";

function Example() {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <ImageEditorModal
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      image={{ kind: "url", url: "https://example.com/photo.jpg", name: "photo.jpg" }}
      onSave={async (result) => {
        // result = { blob, file, dataUrl?, width, height }
        await uploadSomewhere(result.file); // a File, ready to upload
        setIsOpen(false);
      }}
    />
  );
}
```

### Image input

`image` accepts any of these shapes:

```ts
type EditableImageSource =
  | { kind: "url"; url: string; name?: string }
  | { kind: "file"; file: File; name?: string }
  | { kind: "blob"; blob: Blob; name?: string }
  | { kind: "dataUrl"; dataUrl: string; name?: string };
```

Use whichever matches what you already have — a remote URL, a `File` from
an `<input type="file">`, a `Blob`, or a base64 data URL. No manual
conversion needed.

### Save result

`onSave` receives an `ImageEditResult`:

```ts
interface ImageEditResult {
  blob: Blob;
  file: File;
  dataUrl: string | undefined; // see note below
  width: number;
  height: number;
}
```

`blob` and `file` are the same bytes in two wrappers — use `file`/`blob` for
`FormData` uploads, `width`/`height` for validation or layout.

**`dataUrl` is `undefined` by default.** Encoding a full-resolution canvas to
base64 is a synchronous, multi-megabyte, main-thread operation, and most
callers never read it. If you need one (e.g. an inline preview), build it
yourself with `buildImageEditResult(canvas, { includeDataUrl: true })`, or
just call `URL.createObjectURL(result.blob)`.

**`onSave` may be `async`.** If it returns a promise, the editor keeps its
save spinner up and the confirm button disabled until that promise settles —
so your own upload is covered by the same double-tap guard as the export.

### Export format

Save and Download both encode **JPEG at quality 0.85** (`EXPORT_MIME_TYPE` /
`EXPORT_QUALITY`). At native resolution a PNG of a phone photo runs 15–30 MB;
the same picture is ~300 KB as JPEG. Nothing exported is transparent — the
canvas is the photo edge to edge — so there is no alpha to lose.

Need lossless output? Call `buildImageEditResult` yourself with
`{ mimeType: "image/png", quality: undefined }`.

### While the editor is open

It locks background scrolling (on both `<html>` and `<body>`, with the scroll
position restored on close) and traps the browser's back gesture using a
throwaway `history.pushState` entry — so an edge swipe on a phone cannot
navigate the underlying page away mid-edit. The only ways out are the ✕ and
✓ buttons. Both effects are fully undone when the modal closes.

## Next.js usage

This component reads `window`/`document` on mount (canvas, Konva, object
URLs) and **cannot be server-rendered**. In the Next.js App Router, every
component is a Server Component by default, so you must both:

1. Import it with `next/dynamic` and `ssr: false`, and
2. Only render it from inside a Client Component (a file with its own
   `"use client"` at the top) — `ssr: false` is not itself valid inside a
   Server Component.

```jsx
// components/Editor.jsx
"use client";

import dynamic from "next/dynamic";

const ImageEditorModal = dynamic(
  () =>
    import("@vivekjha659/react-image-editor").then((m) => m.ImageEditorModal),
  { ssr: false },
);

export default function Editor({ isOpen, onClose, image, onSave }) {
  return (
    <ImageEditorModal
      isOpen={isOpen}
      onClose={onClose}
      image={image}
      onSave={onSave}
    />
  );
}
```

Then import `components/Editor.jsx` from wherever you need it — Server or
Client Components alike, since dynamic-loading is already handled inside
that wrapper.

## API

| Export | Description |
|---|---|
| `ImageEditorModal` | The editor modal component. |
| `resolveImageSource(source)` | Normalizes an `EditableImageSource` into an `<img>`-usable `src`. Used internally; exported for advanced/custom flows. |
| `getImageSourceKey(source)` | Stable dependency-array key for an `EditableImageSource`. |
| `buildImageEditResult(canvas, options?)` | Builds an `ImageEditResult` from a canvas. Options: `fileName`, `mimeType`, `quality`, `includeDataUrl`. Used internally by the save flow; exported for advanced/custom flows. |
| `buildEditedFileName(name, ext?)` | Output file name for an edited image — strips URL path/query, replaces the source extension, applies an `edited-` prefix without stacking it on re-edits. |
| `extensionForMimeType(mimeType)` | File extension for a blob's *actual* MIME type. `canvas.toBlob()` silently falls back to PNG when it cannot encode the requested format, so always derive the extension from `blob.type`. |
| `EXPORT_MIME_TYPE` / `EXPORT_QUALITY` | The editor's default export encoding (`"image/jpeg"`, `0.85`). |

Full type definitions ship in `dist/index.d.ts` — TypeScript/Next.js
consumers get autocomplete and inline docs out of the box.

## License

MIT © Vivek