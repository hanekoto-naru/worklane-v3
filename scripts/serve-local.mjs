import { createServer } from 'node:http'
import { constants } from 'node:fs'
import { lstat, realpath, open } from 'node:fs/promises'
import { resolve, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HOST = '127.0.0.1'
export const PORT = 4173
export const ORIGIN = `http://${HOST}:${PORT}`
const defaultRoot = fileURLToPath(new URL('../dist/', import.meta.url))
const assetPattern = /^\/assets\/[A-Za-z0-9_-]+\.(?:js|css)$/
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'none'; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; worker-src 'none'; manifest-src 'none'; frame-src 'none'; child-src 'none'; script-src-attr 'none'; style-src-attr 'none'"
export const securityHeaders = Object.freeze({
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=()',
  'Cache-Control': 'no-store',
})
function inside(root, target) {
  const path = relative(root, target)
  return path !== '' && !path.startsWith('..' + sep) && path !== '..' && !isAbsolute(path)
}
async function loadRegularFile(root, path, limit) {
  const target = resolve(root, '.' + path)
  if (!inside(root, target)) throw new Error('Invalid build path')
  const parts = relative(root, target).split(sep)
  let cursor = root
  for (const [index, part] of parts.entries()) {
    cursor = resolve(cursor, part)
    const stat = await lstat(cursor)
    if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) throw new Error('Build contains a symlink')
  }
  if (!inside(root, await realpath(target))) throw new Error('Invalid build path')
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    const pathStat = await lstat(target)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit || stat.ino !== pathStat.ino || stat.dev !== pathStat.dev || !inside(root, await realpath(target))) throw new Error('Invalid build file')
    // Bound the read even if a local process grows the file during startup.
    const buffer = Buffer.alloc(limit + 1)
    let length = 0
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, null)
      if (!result.bytesRead) break
      length += result.bytesRead
    }
    if (length > limit) throw new Error('Build file too large')
    return Buffer.from(buffer.subarray(0, length))
  } finally { await handle.close() }
}
// Accept only the static HTML shell emitted by this app. Unknown markup fails closed.
// This is a structure check, not proof that local JS/CSS or build tools are trustworthy.
function validateHtml(text) {
  const shell = /<!doctype html>|<html lang="ja">|<\/html>|<head>|<\/head>|<body>|<\/body>|<div id="root"><\/div>|<title>[^<&]*<\/title>|<meta charset="UTF-8"\s*\/?>|<meta name="viewport" content="width=device-width, initial-scale=1\.0"\s*\/?>|<meta name="referrer" content="no-referrer"\s*\/?>|<meta http-equiv="Content-Security-Policy" content="[a-z0-9 ;&'#-]+"\s*\/?>|<script type="module"(?: crossorigin)? src="\/assets\/[A-Za-z0-9_-]+\.js"><\/script>|<link rel="stylesheet"(?: crossorigin)? href="\/assets\/[A-Za-z0-9_-]+\.css"\s*\/?>/g
  if (text.replace(shell, '').trim() || (text.match(/<script /g) ?? []).length !== 1 || (text.match(/<link /g) ?? []).length !== 1) throw new Error('Unexpected build HTML')
}
async function loadBuild(distRoot) {
  const path = resolve(distRoot)
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid dist')
  const root = await realpath(path)
  const html = await loadRegularFile(root, '/index.html', 256 * 1024)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(html)
  validateHtml(text)
  const assets = [...text.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1])
  // This build currently has one JS bundle and one CSS bundle, with inline SVG icons.
  if (new Set(assets).size > 16) throw new Error('Too many build assets')
  if (!assets.some(path => path.endsWith('.js')) || !assets.some(path => path.endsWith('.css')) || assets.some(path => !assetPattern.test(path))) throw new Error('Unexpected build assets')
  const files = new Map([
    ['/', { body: html, type: 'text/html; charset=utf-8' }],
    ['/index.html', { body: html, type: 'text/html; charset=utf-8' }],
  ])
  let total = html.length
  for (const path of new Set(assets)) {
    const body = await loadRegularFile(root, path, 20 * 1024 * 1024)
    // All served assets are text; reject corrupt encoding before listening.
    new TextDecoder('utf-8', { fatal: true }).decode(body)
    total += body.length
    if (total > 32 * 1024 * 1024) throw new Error('Build too large')
    files.set(path, { body, type: path.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' })
  }
  return files
}
function singleHeader(request, name) {
  let count = 0
  for (let i = 0; i < request.rawHeaders.length; i += 2) if (request.rawHeaders[i].toLowerCase() === name) count++
  return count <= 1 ? request.headers[name] : false
}

export async function createLocalServer({ distRoot = defaultRoot } = {}) {
  // Snapshot only approved build files before listening. Requests never touch the filesystem.
  const files = await loadBuild(distRoot)
  const server = createServer({ maxHeaderSize: 8192, headersTimeout: 10000, requestTimeout: 10000, keepAliveTimeout: 3000 }, (request, response) => {
    const reply = (status, body, type = 'text/plain; charset=utf-8', extra = {}) => {
      response.writeHead(status, { ...securityHeaders, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extra })
      response.end(request.method === 'HEAD' ? undefined : body)
    }
    const host = singleHeader(request, 'host')
    const origin = singleHeader(request, 'origin')
    const site = singleHeader(request, 'sec-fetch-site')
    if (request.socket.remoteAddress !== HOST || host !== `${HOST}:${PORT}`) return reply(403, 'Forbidden\n', undefined, { Connection: 'close' })
    if (origin === false || (origin !== undefined && origin !== ORIGIN) || site === false || (site !== undefined && !['same-origin', 'none'].includes(site))) return reply(403, 'Forbidden\n', undefined, { Connection: 'close' })
    if (!['GET', 'HEAD'].includes(request.method)) return reply(405, 'Method Not Allowed\n', undefined, { Allow: 'GET, HEAD', Connection: 'close' })
    if (request.headers['transfer-encoding'] || (request.headers['content-length'] && request.headers['content-length'] !== '0')) return reply(400, 'Bad Request\n', undefined, { Connection: 'close' })
    const path = request.url ?? ''
    // No decoding, normalization, queries, SPA fallback, or arbitrary file lookup.
    if (!path.startsWith('/') || path.startsWith('//') || /[%\\?#]|\.\./.test(path)) return reply(400, 'Bad Request\n')
    const file = files.get(path)
    if (!file) return reply(404, 'Not Found\n')
    reply(200, file.body, file.type)
  })
  server.maxConnections = 32
  server.maxRequestsPerSocket = 100
  server.on('upgrade', (_request, socket) => socket.destroy())
  server.on('connect', (_request, socket) => socket.destroy())
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
  })
  return server
}
export function listenLocal(server) {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(PORT, HOST, () => { server.off('error', reject); resolvePromise() })
  })
}
async function main() {
  let server
  try { server = await createLocalServer() } catch {
    process.stderr.write('本番ビルドを読み込めません。npm run buildを実行し、distにリンクや不正なファイルがないか確認してください。\n')
    process.exitCode = 1
    return
  }
  try { await listenLocal(server) } catch (error) {
    process.stderr.write(error.code === 'EADDRINUSE' ? `ポート${PORT}は使用中です。既存のWorklaneやpreviewを終了してください。\n` : 'ローカルサーバーを起動できません。実行権限と設定を確認してください。\n')
    process.exitCode = 1
    return
  }
  process.stdout.write(`Worklane: ${ORIGIN}\n終了: Ctrl+C\n`)
  const stop = () => { server.close(); server.closeAllConnections() }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  server.on('error', () => { process.stderr.write('ローカルサーバーでエラーが発生しました。再起動してください。\n'); stop(); process.exitCode = 1 })
}
if (process.argv[1] && await realpath(process.argv[1]).catch(() => '') === fileURLToPath(import.meta.url)) await main()
