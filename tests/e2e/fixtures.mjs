import { test as base, expect } from '@playwright/test'

export const test = base.extend({
  guard: [async ({ context, browser }, use, testInfo) => {
    testInfo.annotations.push({ type: 'browser', description: `Google Chrome ${browser.version()}; temporary profile; sandbox enabled` })
    const failures = [], requests = []
    let allowedPages = 1, opened = 0
    await context.exposeBinding('__reportViolation', (_source, value) => failures.push(`CSP: ${value}`))
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', event => {
        void window.__reportViolation(`${event.violatedDirective}: ${event.blockedURI}`)
      })
    })
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      const permitted = url.origin === 'http://127.0.0.1:4173' && request.method() === 'GET' && (url.pathname === '/' || url.pathname === '/index.html' || /^\/assets\/[\w-]+\.(js|css)$/.test(url.pathname)) && !url.search
      requests.push({ url: request.url(), type: request.resourceType(), permitted })
      if (!permitted) { failures.push(`Request: ${request.url()}`); await route.abort(); return }
      await route.continue()
    })
    await context.routeWebSocket(/.*/, socket => { failures.push(`WebSocket: ${socket.url()}`); socket.close() })
    context.on('serviceworker', () => failures.push('Unexpected Service Worker'))
    context.on('page', page => {
      if (++opened > allowedPages) failures.push('Unexpected page')
      page.on('console', message => { if (message.type() === 'error') failures.push(`Console: ${message.text()}`) })
      page.on('pageerror', error => failures.push(`Page: ${error.message}`))
      page.on('requestfailed', request => failures.push(`Request failed: ${request.url()}`))
      page.on('worker', () => failures.push('Unexpected Worker'))
    })
    await use({ allowPage() { allowedPages++ } })
    await testInfo.attach('app-network.json', { body: JSON.stringify({ requests, failures }, null, 2), contentType: 'application/json' })
    expect(failures, '外部試行・CSP・Console・pageerror・新規タブ・HMR').toEqual([])
    expect(requests.some(request => request.type === 'document')).toBe(true)
  }, { auto: true }],
  disk: async ({ context }, use) => {
    const disk = { next: 'dummy-a', permission: 'granted', failWrite: false, files: new Map(), dirs: new Set(['dummy-a/', 'dummy-b/']) }
    await context.exposeBinding('__dummyFS', (_source, { op, path, create, text }) => {
      const error = name => ({ error: name })
      if (op === 'pick') return disk.next
      if (op === 'permission') return disk.permission
      if (op === 'directory') {
        if (!disk.dirs.has(path)) { if (!create) return error('NotFoundError'); disk.dirs.add(path) }
        return true
      }
      if (op === 'file') {
        if (!disk.files.has(path)) { if (!create) return error('NotFoundError'); disk.files.set(path, '') }
        return true
      }
      if (op === 'read') return disk.files.has(path) ? disk.files.get(path) : error('NotFoundError')
      if (op === 'write') {
        if (disk.failWrite) return error('QuotaExceededError')
        disk.files.set(path, text); return true
      }
      if (op === 'entries') return [...disk.files.keys()].filter(key => key.startsWith(path) && !key.slice(path.length).includes('/')).map(key => [key.slice(path.length), { kind: 'file' }])
      throw new Error('Unknown mock operation')
    })
    await context.addInitScript(() => {
      const call = async args => {
        const result = await window.__dummyFS(args)
        if (result?.error) throw new DOMException('Dummy filesystem', result.error)
        return result
      }
      function directory(path) {
        return {
          name: path.split('/').filter(Boolean).at(-1), _dummyPath: path,
          queryPermission: () => call({ op: 'permission' }),
          isSameEntry: async other => other._dummyPath === path,
          async getDirectoryHandle(name, options = {}) { const next = path + name + '/'; await call({ op: 'directory', path: next, create: options.create }); return directory(next) },
          async getFileHandle(name, options = {}) {
            const file = path + name
            await call({ op: 'file', path: file, create: options.create })
            return {
              async getFile() { const value = await call({ op: 'read', path: file }); return new Blob([value]) },
              async createWritable() {
                let staged = ''
                return { async write(value) { staged = value }, async close() { await call({ op: 'write', path: file, text: staged }) }, async abort() {} }
              },
            }
          },
          async *entries() { yield* await call({ op: 'entries', path }) },
        }
      }
      window.showDirectoryPicker = async () => directory((await call({ op: 'pick' })) + '/')
    })
    await use(disk)
  },
})
export { expect }
export const modal = page => page.getByRole('dialog', { name: /^(編集|新規登録)：/ })
export const storage = page => page.getByRole('region', { name: 'ローカルファイル保存' })
export async function nav(page, name) {
  await page.getByRole('navigation').getByRole('button', { name: new RegExp('^' + name + '(?: \\d+)?$') }).click()
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
}
export async function confirm(page, action, pattern) {
  const dialog = page.waitForEvent('dialog')
  const pending = action()
  const box = await dialog
  if (pattern) expect(box.message()).toMatch(pattern)
  await box.accept()
  await pending
}
export async function createTask(page, title) {
  await nav(page, '自分のタスク')
  await page.getByRole('button', { name: '新規登録', exact: true }).click()
  await modal(page).getByLabel('タイトル（必須）').fill(title)
  await modal(page).getByRole('button', { name: '登録', exact: true }).click()
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
}
export async function saved(page) { await expect(storage(page).getByRole('status')).toHaveText('保存済み') }
export async function selectEmpty(page) {
  await confirm(page, () => page.getByRole('button', { name: '保存先フォルダを選択', exact: true }).click(), /空のデータ/)
  await saved(page)
}
