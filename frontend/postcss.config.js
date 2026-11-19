// Only tailwindcss — no autoprefixer, because the Tailwind Play CDN used by the
// Stitch export does not prefix either. Landing/Home CSS is imported with `?raw`
// and never goes through PostCSS.
export default {
  plugins: {
    tailwindcss: {},
  },
};
