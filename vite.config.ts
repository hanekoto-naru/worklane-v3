import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const productionCsp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'; manifest-src 'none'; frame-src 'none'; child-src 'none'; script-src-attr 'none'; style-src-attr 'none'"

export default defineConfig({
  plugins: [react(), {
    name: 'worklane-production-csp',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: productionCsp }, injectTo: 'head-prepend' }]
    },
  }],
  build: { modulePreload: false },
  server: { host: '127.0.0.1', strictPort: true },
  preview: { host: '127.0.0.1', strictPort: true },
})
