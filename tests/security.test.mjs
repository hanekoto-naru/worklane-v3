import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { taskSchema, noteSchema } from '../src/data.ts'
import { initialTasks, initialNotes, projects } from './sample-data.mjs'

test('本番HTMLは外部接続・フォーム送信・プラグインを禁止する', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)
  assert.ok(meta, '本番HTMLにはCSPが必要')
  const directives = new Map(meta[1].replaceAll('&#39;', "'").split(';').map(part => {
    const [name, ...values] = part.trim().split(/\s+/)
    return [name, values.join(' ')]
  }))
  for (const key of ['default-src', 'connect-src', 'object-src', 'base-uri', 'form-action', 'worker-src']) {
    assert.equal(directives.get(key), "'none'", key)
  }
  for (const key of ['script-src', 'style-src', 'img-src', 'font-src']) {
    assert.equal(directives.get(key), "'self'", key)
  }
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'))
  for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert.match(url, /^\/assets\/[\w.-]+$/, `外部アセットは禁止: ${url}`)
  }
})

test('不正な日付・ステータス・未知のフィールド・誤った型を拒否する', () => {
  for (const patch of [{ due: '2026-02-30' }, { status: 'unknown' }, { unexpected: true }, { title: 42 }]) {
    assert.equal(taskSchema.safeParse({ ...initialTasks[0], ...patch }).success, false)
  }
  assert.equal(noteSchema.safeParse({ ...initialNotes[0], checked: 'false' }).success, false)
})

test('サンプルデータの参照先とIDに矛盾がない', () => {
  const records = [...initialTasks, ...initialNotes, ...projects]
  assert.equal(new Set(records.map(item => item.id)).size, records.length)
  for (const item of [...initialTasks, ...initialNotes]) {
    assert.ok(projects.some(project => project.id === item.project))
  }
  for (const item of initialTasks.filter(task => task.kind === 'delegated')) {
    assert.ok(item.nextCheck)
  }
})
