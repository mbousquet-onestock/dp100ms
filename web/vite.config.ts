import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_API_PROXY || process.env.VITE_API_PROXY || 'http://localhost:8080';
  const proxy = { '/api': { target, changeOrigin: true } };
  return {
    plugins: [react()],
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
            leaflet: ['leaflet', 'react-leaflet'],
            flow: ['@xyflow/react'],
            charts: ['recharts'],
          },
        },
      },
    },
  };
});
