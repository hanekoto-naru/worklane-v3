import assert from 'node:assert/strict'
import test from 'node:test'
import { request } from 'node:http'
import { connect } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, symlink, link, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalServer, listenLocal, HOST, PORT, ORIGIN, securityHeaders } from '../scripts/serve-local.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'worklane-server-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dist = join(root, 'dist')
  await mkdir(join(dist, 'assets'), { recursive: true })
  await writeFile(join(dist, 'index.html'), '<!doctype html><script type="module" src="/assets/app-test.js"></script><link rel="stylesheet" href="/assets/app-test.css">')
  await writeFile(join(dist, 'assets/app-test.js'), 'const demo = true;')
  await writeFile(join(dist, 'assets/app-test.css'), 'body{color:black}')
  return { root, dist }
}
async function start(t, distRoot) {
  const server = await createLocalServer(distRoot ? { distRoot } : {})
  await new Promise(resolve => server.listen(0, HOST, resolve))
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  assert.equal(server.address().address, '127.0.0.1')
  return { server, port: server.address().port }
}
function get(port, path = '/', method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: HOST, port, path, method, headers: { Host: `${HOST}:${PORT}`, ...headers } }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.end()
  })
}
function raw(port, data) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, HOST, () => socket.end(data))
    const chunks = []
    socket.on('data', chunk => chunks.push(chunk))
    socket.on('end', () => resolve(Buffer.concat(chunks).toString()))
    socket.on('error', reject)
  })
}

test('実ビルドをGET/HEADで配信し、CSP・MIME・全セキュリティヘッダーを付与', async t => {
  const { port } = await start(t)
  const index = await get(port)
  assert.equal(index.status, 200)
  assert.match(index.body, /<div id="root"><\/div>/)
  for (const [name, value] of Object.entries(securityHeaders)) assert.equal(index.headers[name.toLowerCase()], value)
  assert.match(index.headers['content-security-policy'], /frame-ancestors 'none'/)
  assert.doesNotMatch(index.headers['content-security-policy'], /unsafe-inline|unsafe-eval/)
  assert.equal(index.headers['access-control-allow-origin'], undefined)
  const head = await get(port, '/', 'HEAD')
  assert.equal(head.body, '')
  assert.equal(head.headers['content-length'], index.headers['content-length'])
  for (const [, path] of index.body.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const asset = await get(port, path)
    assert.equal(asset.status, 200)
    assert.equal(asset.headers['content-type'], path.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8')
    assert.equal(Buffer.byteLength(asset.body), Number(asset.headers['content-length']))
  }
})

test('GET/HEAD以外の通常HTTPメソッドを拒否', async t => {
  const { port } = await start(t)
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE']) {
    const response = await get(port, '/', method)
    assert.equal(response.status, 405, method)
    assert.equal(response.headers.allow, 'GET, HEAD')
    assert.equal(response.headers['x-content-type-options'], 'nosniff')
  }
})

test('Host完全一致・重複Host・絶対形式・異なるOriginを検証', async t => {
  const { port } = await start(t)
  for (const host of ['evil.invalid', `evil.invalid:${PORT}`, `localhost:${PORT}`, '127.0.0.1', `127.0.0.1:${PORT + 1}`, `127.0.0.1:${PORT}.evil.invalid`]) assert.equal((await get(port, '/', 'GET', { Host: host })).status, 403)
  for (const origin of ['null', 'https://evil.invalid', `http://127.0.0.1:${PORT + 1}`]) assert.equal((await get(port, '/', 'GET', { Origin: origin })).status, 403)
  assert.equal((await get(port, '/', 'GET', { Origin: ORIGIN })).status, 200)
  const duplicate = await raw(port, `GET / HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nHost: evil.invalid\r\nConnection: close\r\n\r\n`)
  assert.match(duplicate, /^HTTP\/1\.1 (?:400|403)/)
  const missing = await raw(port, 'GET / HTTP/1.0\r\n\r\n')
  assert.match(missing, /^HTTP\/1\.1 (?:400|403)/)
  assert.equal((await get(port, `${ORIGIN}/`)).status, 400)
})

test('cross-site・same-siteを拒否し、通常ナビゲーションと同一オリジンを許可', async t => {
  const { port } = await start(t)
  for (const site of ['cross-site', 'same-site', 'invalid']) assert.equal((await get(port, '/', 'GET', { 'Sec-Fetch-Site': site })).status, 403)
  for (const site of ['same-origin', 'none']) assert.equal((await get(port, '/', 'GET', { 'Sec-Fetch-Site': site })).status, 200)
})

test('トラバーサル・エンコード・クエリ・秘密ファイル・JSON・ソースマップを拒否', async t => {
  const { dist } = await fixture(t)
  await writeFile(join(dist, 'data.json'), '{"dummy":"private"}')
  await writeFile(join(dist, 'assets/not-referenced.js'), 'private')
  const { port } = await start(t, dist)
  for (const path of ['/../package.json', '/assets/../../package.json', '/%2e%2e/package.json', '/%252e%252e/data.json', '/assets%2fapp-test.js', '/%00', '/%zz', '/assets\\app-test.js', '//evil.invalid/', '/?secret=sample']) assert.equal((await get(port, path)).status, 400, path)
  for (const path of ['/data.json', '/backups/test.json', '/recovery/test.json', '/.env', '/.git/config', '/src/data.ts', '/package.json', '/assets/app-test.js.map', '/assets/not-referenced.js', '/assets/', '/missing']) {
    const response = await get(port, path)
    assert.equal(response.status, 404, path)
    assert.equal(response.body, 'Not Found\n')
  }
})

test('dist・中間ディレクトリ・ファイルのシンボリックリンクとハードリンクを拒否', async t => {
  const { root, dist } = await fixture(t)
  await symlink(dist, join(root, 'linked-dist'))
  await assert.rejects(createLocalServer({ distRoot: join(root, 'linked-dist') }))
  const outside = join(root, 'outside.js')
  await writeFile(outside, 'private')
  const asset = join(dist, 'assets/app-test.js')
  await rm(asset); await symlink(outside, asset)
  await assert.rejects(createLocalServer({ distRoot: dist }))
  await rm(asset); await link(outside, asset)
  await assert.rejects(createLocalServer({ distRoot: dist }))
  await rm(join(dist, 'assets'), { recursive: true })
  await mkdir(join(root, 'external-assets'))
  await symlink(join(root, 'external-assets'), join(dist, 'assets'))
  await assert.rejects(createLocalServer({ distRoot: dist }))
})

test('起動後のファイル差し替えは配信されず、リクエスト中にディスクへアクセスしない', async t => {
  const { root, dist } = await fixture(t)
  const { port } = await start(t, dist)
  await rm(join(dist, 'assets/app-test.js'))
  await writeFile(join(root, 'secret'), 'private')
  await symlink(join(root, 'secret'), join(dist, 'assets/app-test.js'))
  const response = await get(port, '/assets/app-test.js')
  assert.equal(response.body, 'const demo = true;')
})

test('dist欠落・不完全ビルド・外部資産・不許可資産は起動前に拒否', async t => {
  const { root, dist } = await fixture(t)
  await assert.rejects(createLocalServer({ distRoot: join(root, 'missing') }))
  for (const html of ['', '<script src="https://evil.invalid/a.js"></script>', '<script src="/data.json"></script><link href="/assets/a.css">']) {
    await writeFile(join(dist, 'index.html'), html)
    await assert.rejects(createLocalServer({ distRoot: dist }))
  }
})

test('固定ポートでのみ起動し、使用中なら別ポートへ逃げず失敗', async t => {
  const server = await createLocalServer()
  try { await listenLocal(server) } catch (error) {
    // An existing user process is sufficient evidence that binding must fail.
    assert.equal(error.code, 'EADDRINUSE')
    return
  }
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  assert.equal(server.address().port, PORT)
  assert.equal(server.address().address, HOST)
  const second = await createLocalServer()
  await assert.rejects(listenLocal(second), error => error.code === 'EADDRINUSE')
})

test('ボディ付きGETと不正なHTTPを拒否', async t => {
  const { port } = await start(t)
  assert.equal((await get(port, '/', 'GET', { 'Content-Length': '1' })).status, 400)
  const result = await raw(port, 'INVALID REQUEST\r\n\r\n')
  assert.match(result, /^HTTP\/1\.1 400/)
})

test('起動スクリプトは標準モジュールのみで、起動コマンドはViteを使わない', async () => {
  const source = await readFile(new URL('../scripts/serve-local.mjs', import.meta.url), 'utf8')
  for (const [, specifier] of source.matchAll(/from '([^']+)'/g)) assert.ok(specifier.startsWith('node:'))
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts.start, 'node scripts/serve-local.mjs')
})


test('CLIでdistがない場合は詳細パスを出さずビルドを案内して終了する', async t => {
  const { root } = await fixture(t)
  await mkdir(join(root, 'isolated/scripts'), { recursive: true })
  const script = join(root, 'isolated/scripts/serve-local.mjs')
  await writeFile(script, await readFile(new URL('../scripts/serve-local.mjs', import.meta.url)))
  await assert.rejects(promisify(execFile)(process.execPath, [script]), error => {
    assert.equal(error.code, 1)
    assert.match(error.stderr, /npm run build/)
    assert.doesNotMatch(error.stderr, /ENOENT|Error:|at |worklane-server-test-/)
    return true
  })
})


test('正常アセットを残したHTMLでも外部参照・リダイレクト・インラインコードを拒否', async t => {
  const { dist } = await fixture(t)
  const valid = await readFile(join(dist, 'index.html'), 'utf8')
  for (const injection of [
    "<img src='https://example.invalid/leak'>", '<img src=https://example.invalid/leak>',
    '<meta http-equiv="refresh" content="0;url=https://example.invalid">',
    '<iframe src="https://example.invalid"></iframe>', '<script>alert(1)</script>',
    '<script type="module" src="/assets/app-test.js" onload="alert(1)"></script>',
    '<link rel="dns-prefetch" href="//example.invalid">', '<a href="https://example.invalid">open</a>',
    '<form action="https://example.invalid"></form>', '<base href="https://example.invalid">',
  ]) {
    await writeFile(join(dist, 'index.html'), valid + injection)
    await assert.rejects(createLocalServer({ distRoot: dist }))
  }
})

test('重複Origin・Fetch MetadataとWebSocket/CONNECTトンネルを拒否', async t => {
  const { port } = await start(t)
  for (const header of ['Origin', 'Sec-Fetch-Site']) {
    const value = header === 'Origin' ? ORIGIN : 'same-origin'
    const response = await raw(port, `GET / HTTP/1.1\r\nHost: ${HOST}:${PORT}\r\n${header}: ${value}\r\n${header}: ${value}\r\nConnection: close\r\n\r\n`)
    assert.match(response, /^HTTP\/1\.1 403/)
  }
  for (const request of [
    `GET / HTTP/1.1\r\nHost: ${HOST}:${PORT}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
    `CONNECT example.invalid:443 HTTP/1.1\r\nHost: ${HOST}:${PORT}\r\n\r\n`,
  ]) assert.equal(await raw(port, request), '')
})


test('HTML・JS・CSSの不正UTF-8を起動前に拒否する', async t => {
  const { dist } = await fixture(t)
  for (const file of ['index.html', 'assets/app-test.js', 'assets/app-test.css']) {
    const path = join(dist, file)
    const original = await readFile(path)
    await writeFile(path, Buffer.concat([original, Buffer.from([0xc3, 0x28])]))
    await assert.rejects(createLocalServer({ distRoot: dist }))
    await writeFile(path, original)
  }
})
