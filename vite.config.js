import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    root: 'web',
    envDir: process.cwd(),
    envPrefix: ['VITE_', 'FLIGHT_'],
    server: {
      host: '0.0.0.0',
      proxy: {
        '/opensearch': {
          target: env.OPENSEARCH_NODE || 'http://localhost:9200',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/opensearch/, ''),
        },
      },
    },
    build: {
      outDir: '../dist/dashboard',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/recharts/')) return 'charts';
            if (
              id.includes('/node_modules/react/') ||
              id.includes('/node_modules/react-dom/') ||
              id.includes('/node_modules/scheduler/')
            ) return 'react-vendor';
          },
        },
      },
    },
  };
});
