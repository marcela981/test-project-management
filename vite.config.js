import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    base: '/app/',
    plugins: [react()],
    test: {
        environment: 'node',
        include: ['src/**/__tests__/**/*.test.js'],
    },
});
