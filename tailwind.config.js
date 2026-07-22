/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  // Consumers are dropping this component into their own app, which may
  // already have its own global reset/base styles. We only want our utility
  // classes, not Tailwind's Preflight reset stepping on their app.
  corePlugins: {
    preflight: false,
  },
  prefix: "rie-v0.1.1",
  theme: {
    extend: {},
  },
  plugins: [],
};
