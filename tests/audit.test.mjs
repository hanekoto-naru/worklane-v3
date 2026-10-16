import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import ts from 'typescript'
import { urlSchema } from '../src/data.ts'

const root = new URL('../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
function prohibitedCalls(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JS)
  const found = []
  function visit(node) {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = node.expression
      const name = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression) ? expression.argumentExpression.text : ''
      if (['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport', 'Worker', 'SharedWorker', 'Image', 'Audio', 'importScripts', 'eval'].includes(name)) found.push(name)
    }
    if (/\.tsx?$/.test(file) && ts.isCallExpression(node) && /^document\.(?:createElement|write|writeln)$/.test(node.expression.getText(source))) found.push('dynamic DOM resource')
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) found.push('dynamic import')
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && /^(?:window|globalThis|self)(?:\.|\[)/.test(node.getText(source)) && /(?:fetch|XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection|WebTransport|open)[\x22\x27\]]*$/.test(node.getText(source))) found.push('global capability')
    if (ts.isIdentifier(node) && ['serviceWorker', 'clipboard', 'localStorage', 'sessionStorage', 'indexedDB'].includes(node.text)) found.push(node.text)
    if (ts.isCallExpression(node) && /(?:location\.(?:assign|replace)|window\.open)$/.test(node.expression.getText(source))) found.push('navigation')
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && /^(?:(?:window|globalThis|self)\.)?location(?:\.href)?$/.test(node.left.getText(source))) found.push('navigation assignment')
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'a') {
      const attributes = node.attributes.properties
      const href = attributes.find(attr => ts.isJsxAttribute(attr) && attr.name.text === 'href')
      if (!href?.initializer || !ts.isStringLiteral(href.initializer) || !/^#[A-Za-z0-9/_-]+$/.test(href.initializer.text) || attributes.some(attr => ts.isJsxSpreadAttribute(attr) || (ts.isJsxAttribute(attr) && ['ping', 'target'].includes(attr.name.text)))) found.push('external anchor')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

test('ソースに通信処理・永続ブラウザーストレージ・HTML挿入・selectがない', async () => {
  for (const file of (await readdir(new URL('src/', root))).filter(file => /\.tsx?$/.test(file))) {
    const text = await read('src/' + file)
    assert.deepEqual(prohibitedCalls(text, file), [], file)
    assert.equal(/dangerouslySetInnerHTML|\.innerHTML\s*=|\blocalStorage\b|\bindexedDB\b|console\.(?:log|warn|error)|<(?:img|iframe|script|link|object|embed)\b|<form[^>]*\baction=|<select\b|type="radio"/.test(text), false, file)
  }
})

test('本番JSに通信呼び出しがなく、HTML/CSSのアセット参照がローカル', async () => {
  for (const file of await readdir(new URL('dist/assets/', root))) {
    const text = await read('dist/assets/' + file)
    assert.doesNotMatch(file, /\.map$/)
    assert.doesNotMatch(text, /sourceMappingURL|@vite\/client|react-refresh|import\.meta\.env|VITE_[A-Z_]+/)
    if (file.endsWith('.js')) assert.deepEqual(prohibitedCalls(text, file), [], file)
    if (file.endsWith('.css')) {
      assert.doesNotMatch(text, /@import\b/i)
      for (const [, target] of text.matchAll(/url\(\s*["']?([^)'"\s]+)/gi)) assert.doesNotMatch(target, /^(?:[a-z]+:|\/\/)/i)
    }
  }
  const html = await read('dist/index.html')
  for (const [, target] of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.match(target, /^\/assets\//)
  assert.doesNotMatch(html, /@vite\/client|localhost|ws:\/\//)
})

test('CSPでフレーム・接続・インライン属性を禁止する', async () => {
  const html = (await read('dist/index.html')).replaceAll('&#39;', "'")
  for (const name of ['connect-src', 'frame-src', 'child-src', 'script-src-attr', 'style-src-attr', 'object-src', 'form-action']) assert.ok(html.includes(`${name} 'none'`), name)
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/)
})

test('不正なエンコード・資格情報・制御文字を含むURLを拒否', () => {
  for (const url of ['https://example.com/%zz', 'https://example.com/%0a', 'https://%65xample.com/', 'https://user@example.com/', 'javascript%3Aalert(1)', 'data:text/html,test']) assert.equal(urlSchema.safeParse(url).success, false, url)
  for (const url of ['https://example.com/%E6%97%A5', 'https://example.com/?a=1&b=2', 'https://例え.jp/']) assert.equal(urlSchema.safeParse(url).success, true, url)
})


test('通信検査は危険なAPI・動的import・遷移・暗黙コピーの追加を検出する', () => {
  for (const source of [
    'fetch("/leak")', 'window["fetch"]("/leak")', 'const send = window.fetch; send("/leak")',
    'new XMLHttpRequest()', 'new WebSocket("wss://example.invalid")', 'new EventSource("/stream")',
    'navigator.sendBeacon("/leak", data)', 'new RTCPeerConnection()', 'new WebTransport("https://example.invalid")',
    'new Image()', 'new Audio()', 'document.createElement("script")', 'document.write(data)', 'new Worker("/worker.js")', 'new SharedWorker("/worker.js")', 'importScripts("/worker.js")',
    'navigator.serviceWorker.register("/sw.js")', 'import("https://example.invalid/x.js")',
    'window.open(url)', 'location.href = url', 'window.location = url', 'location.assign(url)',
    'navigator.clipboard.writeText(data)', 'localStorage.setItem("data", data)', 'indexedDB.open("data")',
  ]) assert.ok(prohibitedCalls(source, 'negative.tsx').length > 0, source)
})

test('lockfileと依存定義が一致し、取得元・integrity・lifecycle設定を制限する', async () => {
  const pkg = JSON.parse(await read('package.json'))
  const lock = JSON.parse(await read('package-lock.json'))
  for (const key of ['dependencies', 'devDependencies']) assert.deepEqual(lock.packages[''][key], pkg[key])
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name) continue
    assert.equal(new URL(entry.resolved).origin, 'https://registry.npmjs.org', name)
    assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]+=*$/, name)
  }
  assert.deepEqual(Object.keys(pkg.scripts).sort(), ['build', 'dev', 'lint', 'start', 'test', 'test:files'])
  assert.match(await read('.npmrc'), /^ignore-scripts=true$/m)
  assert.match(await read('.npmrc'), /^save-exact=true$/m)
})


test('外部・動的リンクは拒否し、固定フラグメントのスキップリンクだけを許可する', () => {
  for (const source of ['<a href="https://example.invalid">link</a>', '<a href={url}>link</a>', '<a href="#main" ping="https://example.invalid">link</a>', '<a href="#main" {...props}>link</a>']) assert.ok(prohibitedCalls(source, 'negative.tsx').length)
  assert.deepEqual(prohibitedCalls('<a href="#main">本文へ移動</a>', 'safe.tsx'), [])
})
