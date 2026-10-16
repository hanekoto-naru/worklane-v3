import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAction, initialState as emptyInitialState, projectCounts, sortTasks, taskSchema, urlSchema } from '../src/data.ts'

import { initialState } from './sample-data.mjs'

test('アプリの初期状態は空で、テストデータと分離されている', () => {
  assert.deepEqual(emptyInitialState, { tasks: [], notes: [], projects: [], people: [] })
})

const put = (state, kind, value, person) => applyAction(state, { type: 'put', kind, value, person })

test('3種類の業務を登録・編集・削除でき、初期データを変更しない', () => {
  for (const [kind, sample] of [['task', initialState.tasks[0]], ['task', initialState.tasks[5]], ['note', initialState.notes[0]]]) {
    const key = kind === 'task' ? 'tasks' : 'notes'
    const value = { ...sample, id: 'new-record', title: 'テスト登録' }
    let state = put(initialState, kind, value)
    assert.equal(state[key].length, initialState[key].length + 1)
    state = put(state, kind, { ...value, title: '編集後', detail: '詳細変更' })
    assert.equal(state[key].find(item => item.id === value.id).title, '編集後')
    assert.equal(state[key].length, initialState[key].length + 1)
    state = applyAction(state, { type: 'delete', kind, id: value.id })
    assert.deepEqual(state[key], initialState[key])
  }
})

test('種類別の全ステータスを許可し、別種類のステータスを拒否', () => {
  for (const status of ['未着手', '進行中', '保留', '完了']) assert.ok(taskSchema.safeParse({ ...initialState.tasks[0], status }).success)
  for (const status of ['依頼済み', '対応中', 'レビュー待ち', '完了']) assert.ok(taskSchema.safeParse({ ...initialState.tasks[5], status }).success)
  assert.equal(taskSchema.safeParse({ ...initialState.tasks[0], status: 'レビュー待ち' }).success, false)
  assert.equal(taskSchema.safeParse({ ...initialState.tasks[5], status: '保留' }).success, false)
})

test('新しい担当者を登録して再利用できる', () => {
  const person = { id: 'new-person', name: 'テスト担当者' }
  let state = put(initialState, 'task', { ...initialState.tasks[5], owner: person.id }, person)
  assert.equal(state.people.length, initialState.people.length + 1)
  state = put(state, 'note', { ...initialState.notes[0], person: person.id })
  assert.equal(state.notes.find(n => n.id === initialState.notes[0].id).person, person.id)
  assert.throws(() => put(state, 'task', initialState.tasks[5], { id: 'duplicate', name: person.name }))
})

test('存在しない参照・重複ID・種類の変更を拒否', () => {
  for (const patch of [{ project: 'missing' }, { owner: 'missing' }, { id: initialState.projects[0].id }]) {
    assert.throws(() => put(initialState, 'task', { ...initialState.tasks[5], ...patch }))
  }
  assert.throws(() => put(initialState, 'note', { ...initialState.notes[0], person: 'missing' }))
  assert.throws(() => put(initialState, 'task', { ...initialState.tasks[0], id: initialState.tasks[5].id }))
  assert.throws(() => applyAction(initialState, { type: 'delete', kind: 'note', id: 'missing' }))
})

test('プロジェクトの登録・編集・アーカイブでも関連業務を保持する', () => {
  let state = put(initialState, 'project', { id: 'new-project', name: '検証用', description: '', due: '', archived: false })
  state = put(state, 'task', { ...initialState.tasks[0], project: 'new-project' })
  state = put(state, 'note', { ...initialState.notes[0], project: 'new-project' })
  assert.deepEqual(projectCounts(state, 'new-project'), { total: 2, done: 0, open: 2 })
  state = put(state, 'project', { ...state.projects.find(p => p.id === 'new-project'), name: '名称変更', archived: true })
  assert.equal(state.projects.find(p => p.id === 'new-project').archived, true)
  assert.equal(projectCounts(state, 'new-project').total, 2)
})

test('完了・確認済み・削除が横断集計と未完了件数に反映される', () => {
  const before = projectCounts(initialState, 'p1')
  let state = put(initialState, 'task', { ...initialState.tasks[0], status: '完了' })
  state = put(state, 'note', { ...initialState.notes[0], checked: true })
  assert.equal(projectCounts(state, 'p1').done, before.done + 2)
  assert.equal(projectCounts(state, 'p1').open, before.open - 2)
  assert.equal(state.tasks.filter(t => t.kind === 'mine' && t.status !== '完了').length, 3)
  state = applyAction(state, { type: 'delete', kind: 'task', id: initialState.tasks[0].id })
  assert.equal(projectCounts(state, 'p1').total, before.total - 1)
})

test('空白の必須項目・長すぎる入力・無効日付を拒否、任意日付の空欄は許可', () => {
  for (const patch of [{ title: '  ' }, { title: 'a'.repeat(201) }, { detail: 'a'.repeat(10001) }, { due: '2026-02-30' }]) {
    assert.throws(() => put(initialState, 'task', { ...initialState.tasks[0], ...patch }))
  }
  assert.throws(() => put(initialState, 'task', { ...initialState.tasks[5], nextCheck: 'invalid' }))
  assert.ok(taskSchema.safeParse({ ...initialState.tasks[0], due: '', project: '', priority: 'なし' }).success)
})

test('危険なスキーム・認証情報・制御文字・相対URLを拒否', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test', '//example.com', '/path', 'https://user:pass@example.com', 'https://exa\nmple.com', 'https://example.com/a b', 'https:\\example.com', 'https://']) {
    assert.equal(urlSchema.safeParse(url).success, false, url)
  }
  for (const url of ['', 'https://example.com/path?q=test#section', 'http://127.0.0.1:8000/']) assert.ok(urlSchema.safeParse(url).success)
})

test('期限未設定は末尾、優先度・タイトルによる並び替えが可能', () => {
  const rows = [
    { ...initialState.tasks[0], id: 'a', title: 'B', due: '', priority: 'なし' },
    { ...initialState.tasks[0], id: 'b', title: 'A', due: '2026-10-16', priority: '低' },
    { ...initialState.tasks[0], id: 'c', title: 'C', due: '2026-10-15', priority: '高' },
  ]
  assert.deepEqual(sortTasks(rows, 'due').map(t => t.id), ['c', 'b', 'a'])
  assert.deepEqual(sortTasks(rows, 'priority').map(t => t.id), ['c', 'b', 'a'])
  assert.deepEqual(sortTasks(rows, 'title').map(t => t.id), ['b', 'a', 'c'])
  assert.equal(rows[0].id, 'a')
})

test('設定から関係者を登録・改名しても依頼と確認事項の参照を維持する', () => {
  const person = { id: 'settings-person', name: '営業担当（架空）' }
  let state = put(initialState, 'person', person)
  state = put(state, 'task', { ...initialState.tasks[5], owner: person.id })
  state = put(state, 'note', { ...initialState.notes[0], person: person.id })
  const tasks = state.tasks
  const notes = state.notes
  state = put(state, 'person', { ...person, name: '営業窓口（架空）' })
  assert.equal(state.people.find(p => p.id === person.id).name, '営業窓口（架空）')
  assert.equal(state.people.length, initialState.people.length + 1)
  assert.deepEqual(state.tasks, tasks)
  assert.deepEqual(state.notes, notes)
  assert.throws(() => put(state, 'person', { ...person, name: ' ' }))
  assert.throws(() => put(state, 'person', { ...person, name: 'x'.repeat(201) }))
  assert.throws(() => put(state, 'person', { ...person, name: initialState.people[0].name }))
  assert.throws(() => put(state, 'person', { ...person, id: initialState.projects[0].id }))
  assert.equal(initialState.people.some(p => p.id === person.id), false)
})

test('曜日付き日付はタイムゾーンに依存せず、空欄・不正日付を安全に表示する', async () => {
  const { shortDate } = await import('../src/data.ts')
  assert.equal(shortDate('2026-10-15'), '10/15（木）')
  assert.equal(shortDate('2026-10-18', true), '2026/10/18（日）')
  assert.equal(shortDate('2024-02-29'), '2/29（木）')
  assert.equal(shortDate(''), '—')
  assert.equal(shortDate('2026-02-30'), '—')
})
test('複数URLは全件を検証し、10件の上限と既存の単一URLを維持する', () => {
  const sample = initialState.tasks[0]
  assert.deepEqual(taskSchema.parse({ ...sample, url: ['https://example.com/a', 'https://example.com/b'] }).url, ['https://example.com/a', 'https://example.com/b'])
  for (const url of [['https://example.com', 'javascript:alert(1)'], ['https://example.com', ''], Array(11).fill('https://example.com'), [], ['https://example.com']]) {
    assert.equal(taskSchema.safeParse({ ...sample, url }).success, false)
  }
  assert.equal(taskSchema.parse({ ...sample, url: 'https://example.com' }).url, 'https://example.com')
})


test('関係者ラベルの変更後も担当者・確認相手の参照を維持する', () => {
  const person = initialState.people[0]
  const next = put(initialState, 'person', { ...person, labels: ['後輩', 'チーム外'] })
  assert.deepEqual(next.people.find(value => value.id === person.id).labels, ['後輩', 'チーム外'])
  assert.deepEqual(next.tasks, initialState.tasks)
  assert.deepEqual(next.notes, initialState.notes)
  assert.equal(initialState.people[0].labels, undefined)
})

test('ページURLは全画面を区別し、不明なURLはダッシュボードに戻す', async () => {
  const { pages, pageFromHash, pageHash } = await import('../src/navigation.ts')
  for (const page of pages) assert.equal(pageFromHash(pageHash(page)), page)
  for (const hash of ['', '#/unknown', '#/mine?name=test', '#/javascript:alert(1)']) assert.equal(pageFromHash(hash), 'dashboard')
})
