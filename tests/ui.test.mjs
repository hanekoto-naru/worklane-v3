import './register-ui.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const { Choice, Toggle } = await import('../src/Choice.tsx')
const { default: Editor } = await import('../src/Editor.tsx')
const { default: Paged } = await import('../src/Paged.tsx')
import { initialState } from './sample-data.mjs'
import { nextChoiceIndex, searchChoices } from '../src/selection.ts'

const options = ['なし', '低', '中', '高'].map(value => ({ value, label: value }))
test('選択ボタンは押下状態とチェックを持ち、フォーム値を保持する', () => {
  const html = renderToStaticMarkup(createElement(Choice, { label: '優先度', options, name: 'priority', defaultValue: '高', icon: 'priority' }))
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1)
  assert.match(html, /name="priority" value="高"/)
  assert.match(html, /role="group" aria-label="優先度"/)
  assert.doesNotMatch(html, /<select|type="radio"/)
})
test('矢印キー・Home・Endの移動、検索の正規化', () => {
  assert.equal(nextChoiceIndex(0, 4, 'ArrowLeft'), 3)
  assert.equal(nextChoiceIndex(3, 4, 'ArrowRight'), 0)
  assert.equal(nextChoiceIndex(1, 4, 'ArrowUp'), 0)
  assert.equal(nextChoiceIndex(1, 4, 'ArrowDown'), 2)
  assert.equal(nextChoiceIndex(2, 4, 'Home'), 0)
  assert.equal(nextChoiceIndex(0, 4, 'End'), 3)
  assert.equal(nextChoiceIndex(0, 0, 'ArrowRight'), null)
  for (const key of ['Tab', 'Enter', ' ']) assert.equal(nextChoiceIndex(0, 4, key), null)
  assert.deepEqual(searchChoices([{ value: 'a', label: 'ABC担当' }], ' abc '), [{ value: 'a', label: 'ABC担当' }])
})
test('多数候補はドロップダウンではなくダイアログの起動ボタン', () => {
  const html = renderToStaticMarkup(createElement(Choice, { label: '担当者', options: Array.from({ length: 10000 }, (_, i) => ({ value: String(i), label: `担当${i}` })), value: '10' }))
  assert.match(html, /aria-haspopup="dialog"/)
  assert.match(html, /担当10/)
  assert.equal((html.match(/<button/g) ?? []).length, 1)
})
test('スイッチは状態を伝え、ONだけフォーム値を含める', () => {
  for (const active of [true, false]) {
    const html = renderToStaticMarkup(createElement(Toggle, { label: '確認済み', name: 'checked', defaultChecked: active }))
    assert.match(html, new RegExp(`role="switch" aria-checked="${active}"`))
    assert.equal(html.includes('name="checked"'), active)
    assert.match(html, new RegExp(active ? 'ON' : 'OFF'))
  }
})
test('編集パネルと選択候補はHTML・スクリプトをテキストとしてエスケープ', () => {
  const payload = '<img src="https://evil.invalid/leak" onerror="alert(1)"><script>alert(1)</script>'
  for (const editor of [
    { kind: 'task', value: { ...initialState.tasks[0], title: payload, detail: payload } },
    { kind: 'note', value: { ...initialState.notes[0], title: payload, detail: payload } },
    { kind: 'project', value: { ...initialState.projects[0], name: payload, description: payload } },
  ]) {
    const html = renderToStaticMarkup(createElement(Editor, { editor, state: initialState, commit() {}, close() {}, fileMode: true, readOnly: false }))
    assert.doesNotMatch(html, /<img|<script|<select/)
    assert.match(html, /&lt;img/)
  }
  const html = renderToStaticMarkup(createElement(Choice, { label: '相手', options: [{ value: 'x', label: payload }] }))
  assert.doesNotMatch(html, /<img|<script/)
})
test('大量データの一覧描画を100件に制限する', () => {
  const html = renderToStaticMarkup(createElement(Paged, { items: Array.from({ length: 10000 }, (_, i) => i), children: rows => createElement('div', null, rows.map(i => createElement('span', { key: i, 'data-row': true }, i))) }))
  assert.equal((html.match(/data-row/g) ?? []).length, 100)
  assert.match(html, /10000件/)
  assert.match(html, /次の100件/)
})

test('設定は関係者を初期表示し、ラベル一覧を混在させない', async () => {
  const { default: Settings } = await import('../src/Settings.tsx')
  const html = renderToStaticMarkup(createElement(Settings, { state: initialState, openEditor() {}, disabled: true }))
  assert.match(html, /aria-label="設定項目"/)
  assert.match(html, /aria-label="関係者を検索"/)
  assert.match(html, /関係者を追加/)
  assert.doesNotMatch(html, /ラベルを追加/)
  assert.equal((html.match(/<table/g) ?? []).length, 1)
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 2)
  assert.match(html, /disabled=""[^>]*>.*?関係者を追加/)
  assert.doesNotMatch(html, /<select|type="radio"/)
})

test('複数URLの編集欄と曜日を描画し、外部リンクを生成しない', () => {
  const html = renderToStaticMarkup(createElement(Editor, {
    editor: { kind: 'task', value: { ...initialState.tasks[0], url: ['https://example.com/a', 'https://example.com/b'] } },
    state: initialState, commit() {}, close() {}, fileMode: true, readOnly: false,
  }))
  assert.equal((html.match(/name="url"/g) ?? []).length, 2)
  assert.doesNotMatch(html, /<a\b|target="_blank"/)
  assert.match(html, /https:\/\/example.com\/a/)
  assert.match(html, /10\/15（木）/)
  assert.match(html, /URLを追加/)
  const bad = renderToStaticMarkup(createElement(Editor, {
    editor: { kind: 'task', value: { ...initialState.tasks[0], url: 'javascript:alert(1)' } },
    state: initialState, commit() {}, close() {}, fileMode: false, readOnly: false,
  }))
  assert.doesNotMatch(bad, /<a /)
})


test('関係者の複数ラベルを選択状態とフォーム値に反映する', () => {
  const html = renderToStaticMarkup(createElement(Editor, {
    editor: { kind: 'person', value: { ...initialState.people[0], labels: ['チーム外', '営業'] } },
    state: initialState, commit() {}, close() {}, fileMode: true, readOnly: false,
  }))
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 2)
  assert.ok(html.includes('name="labels" value="[&quot;チーム外&quot;,&quot;営業&quot;]"'))
  assert.doesNotMatch(html, /先輩|後輩/)
  for (const label of ['チーム外', '営業']) assert.ok(html.includes(label))
  assert.doesNotMatch(html, /<select|type="radio"/)
})
