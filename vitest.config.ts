// Scene tests run the real @dcl/ecs engine headless in Node. The explorer's runtime modules (~system/*) don't exist
// outside Decentraland, so they resolve to the stand-ins in test/system. JSX is the SDK's classic ReactEcs factory.
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: [{ find: /^~system\/(.*)$/, replacement: path.resolve(__dirname, 'test/system/$1.ts') }]
  },
  esbuild: { jsx: 'transform', jsxFactory: 'ReactEcs.createElement', jsxFragment: 'ReactEcs.Fragment' },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node'
  }
})
