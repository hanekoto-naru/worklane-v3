// Test-only TypeScript/TSX loader using the already installed compiler.
import { registerHooks } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('.css')) return { url: 'data:text/javascript,export default new Proxy({}, {get:(_,key)=>String(key)})', shortCircuit: true }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const base = new URL(specifier, context.parentURL)
      for (const extension of ['', '.ts', '.tsx']) {
        const url = base.href + extension
        if (/\.tsx?$/.test(url) && existsSync(fileURLToPath(url))) return { url, shortCircuit: true }
      }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (/\.tsx?$/.test(url)) {
      return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX } }).outputText }
    }
    return next(url, context)
  },
})
