import { defineConfig } from 'vitest/config'

// The development mock compiles into .mock-dist. Those are build outputs, not tests.
export default defineConfig({ test: { exclude: ['node_modules', 'dist', '.mock-dist'] } })
