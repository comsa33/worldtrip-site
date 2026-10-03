import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { searchDev } from './dev/searchDev';
import { dataVersion } from './scripts/dataVersion';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), searchDev()],
  // the version of the data /api/search answers from, in its URLs: a deploy
  // with new data is a new edge-cache key
  define: { __DATA_V__: JSON.stringify(dataVersion()) },
});
