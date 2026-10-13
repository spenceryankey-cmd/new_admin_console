import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

// The development mock compiles into .mock-dist. Those are build outputs, not tests.
// SWC keeps the decorator metadata Nest needs to inject services by type, as the real build does.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { exclude: ['node_modules', 'dist', '.mock-dist'] },
})
