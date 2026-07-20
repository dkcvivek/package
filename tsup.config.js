import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.js"],
  format: ["cjs", "esm"], // tsup auto-outputs index.js (cjs) + index.mjs (esm)
  splitting: false,
  sourcemap: true,
  clean: true,
  // We hand-write index.d.ts ourselves (Step 4) instead of asking tsup to
  // infer types from JSX source, so no dts generation here.
  dts: false,
  external: [
    "react",
    "react-dom",
    "react-konva",
    "konva",
    "lucide-react",
    "react-icons",
    "react-toastify",
  ],
  esbuildOptions(options) {
    options.jsx = "automatic";
  },

  banner: {
    js: '"use client";',
  },
});
