# @vivekjha659/react-image-editor

A portable, WhatsApp-style image editor modal for React and Next.js apps —
crop, freehand drawing, shapes (rectangle / circle / arrow / double-arrow /
curve), and text overlays. Ships with a dedicated mobile UI and a separate
desktop sidebar UI.

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
      onSave={(result) => {
        // result = { blob, file, dataUrl, width, height }
        console.log(result.file); // a File, ready to upload
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
  dataUrl: string;
  width: number;
  height: number;
}
```

All four are derived from the same flattened canvas — pick whichever your
upload pipeline needs (`file`/`blob` for `FormData` uploads, `dataUrl` for
inline previews, `width`/`height` for validation or layout).

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
| `buildImageEditResult(canvas, options?)` | Builds an `ImageEditResult` from a canvas. Used internally by the save flow; exported for advanced/custom flows. |

Full type definitions ship in `dist/index.d.ts` — TypeScript/Next.js
consumers get autocomplete and inline docs out of the box.

## License

MIT © Vivek