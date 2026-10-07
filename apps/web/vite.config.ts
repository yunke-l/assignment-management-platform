import { defineConfig } from 'vite';
import process from 'node:process';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [
    {
      name: 'correct-zod-prose-annotations',
      enforce: 'pre',
      transform(code, id) {
        if (!/\/zod\/v4\/core\/(util|regexes)\.js$/.test(id)) return null;
        // Zod 4.6.5 uses the compiler directive inside two explanatory comments.
        // Correct only those prose references; preserve actual PURE annotations
        // and all executable code. Rollup warning reporting stays enabled.
        const corrected = code.replaceAll('a `@__PURE__`', 'a pure');
        return corrected === code ? null : { code: corrected, map: null };
      },
    },
    react(),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3100' },
  },
});
