import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'vite-plugin-electron/simple'
import vue from '@vitejs/plugin-vue'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    vue(),

    electron({
      main: {
        entry: 'electron/main.ts',

        vite: {
          build: {
            rollupOptions: {
              external: [
                'better-sqlite3',
                'electron-updater',
              ],
            },
          },
        },
      },

      preload: {
        input: path.join(
          __dirname,
          'electron/preload.ts'
        ),
      },

      renderer:
        process.env.NODE_ENV ===
        'test'
          ? undefined
          : {},
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: path.join(projectRoot, 'index.html'),
        overlay: path.join(projectRoot, 'overlay.html'),
      },
    },
  },
})
