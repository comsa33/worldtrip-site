import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { searchDev } from './dev/searchDev';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), searchDev()],
});
