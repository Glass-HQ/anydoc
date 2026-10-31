import { defineConfig } from 'vite';

// Served from the repository's GitHub Pages path.
export default defineConfig({ base: './', build: { target: 'es2023' } });
