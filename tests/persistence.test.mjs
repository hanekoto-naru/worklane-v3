import assert from 'node:assert/strict'
import test from 'node:test'
import { initialState } from './sample-data.mjs'
import { FileStore, MAX_BYTES, MAX_RECORDS, cancelled, emptyState, parseDocument, serialize, toState, rejectRepository } from '../src/persistence.ts'

function memoryDisk() {
  const files = new Map()
  const dirs = new Set([''])
  const events = []
  let permission = 'granted'
  let fault = () => {}
  let hook = () => {}
  const missing = () => new DOMException('Missing', 'NotFoundError')
  const dir = (path = '') => ({
    name: path || 'test-folder',
    queryPermission: async () => permission,
    isSameEntry: async other => other.name === (path || 'test-folder'),
    async getFileHandle(name, options) {
      const key = path + name
      fault('handle', key)
      if (!files.has(key)) {
        if (!options?.create) throw missing()
        files.set(key, '')
      }
      return {
        async getFile() {
          fault('read', key)
          if (!files.has(key)) throw missing()
          const bytes = new TextEncoder().encode(files.get(key))
          return { size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }
        },
        async createWritable() {
          fault('open', key)
          let staged = ''
          events.push(['open', key])
          return {
            async write(text) { fault('write', key); staged = text; await hook('write', key) },
            async close() { fault('close', key); files.set(key, staged); events.push(['close', key]); await hook('close', key) },
            async abort() { events.push(['abort', key]) },
          }
        },
      }
    },
    async getDirectoryHandle(name, options) {
      const key = path + name + '/'
      fault('directory', key)
      if (!dirs.has(key)) { if (!options?.create) throw missing(); dirs.add(key) }
      return dir(key)
    },
    async *entries() {
      for (const name of files.keys()) if (name.startsWith(path) && !name.slice(path.length).includes('/')) yield [name.slice(path.length), { kind: 'file' }]
    },
  })
  let tail = Promise.resolve()
  const lock = job => { const next = tail.then(job); tail = next.catch(() => {}); return next }
  return { files, dirs, events, directory: dir(), lock, setPermission: value => { permission = value }, fail: fn => { fault = fn }, on: fn => { hook = fn } }
}
async function fixture(state = initialState) {
  const disk = memoryDisk()
  const store = new FileStore(disk.directory, disk.lock)
  assert.equal(await store.load(), null)
  await store.save(state)
  return { disk, store }
}
const changed = title => ({ ...initialState, tasks: [{ ...initialState.tasks[0], title }, ...initialState.tasks.slice(1)] })
const diskDoc = disk => parseDocument(disk.files.get('data.json'))

test('初回作成と、新しいセッションでの再選択・再読み込み', async () => {
  const { disk } = await fixture(emptyState)
  assert.equal(diskDoc(disk).revision, 1)
  const restarted = new FileStore(disk.directory, disk.lock)
  assert.deepEqual(toState(await restarted.load()), emptyState)
  assert.equal(disk.files.size, 1)
})

test('追加・編集・削除を保存し、更新前の正本を検証済みバックアップに保持', async () => {
  const { disk, store } = await fixture()
  const original = disk.files.get('data.json')
  const added = { ...initialState, tasks: [...initialState.tasks, { ...initialState.tasks[0], id: 'added' }] }
  await store.save(added)
  assert.equal(diskDoc(disk).tasks.length, initialState.tasks.length + 1)
  await store.save({ ...added, tasks: added.tasks.map(t => t.id === 'added' ? { ...t, status: '完了' } : t) })
  await store.save(initialState)
  assert.equal(diskDoc(disk).revision, 4)
  const list = await store.listBackups()
  assert.equal(list.names.length, 3)
  const revisions = list.names.map(name => parseDocument(disk.files.get('backups/' + name)).revision).sort()
  assert.deepEqual(revisions, [1, 2, 3])
  assert.ok([...disk.files.entries()].some(([name, text]) => name.startsWith('backups/') && text === original))
})

test('権限失効時は書き込まず、再付与後に再試行できる', async () => {
  const { disk, store } = await fixture()
  const original = disk.files.get('data.json')
  disk.setPermission('denied')
  await assert.rejects(store.save(changed('未保存')), /権限/)
  assert.equal(disk.files.get('data.json'), original)
  disk.setPermission('granted')
  await store.save(changed('再試行'), true)
  assert.equal(diskDoc(disk).tasks[0].title, '再試行')
})

test('キャンセルは通常のファイルエラーと区別できる', () => {
  assert.equal(cancelled(new DOMException('', 'AbortError')), true)
  assert.equal(cancelled(new DOMException('', 'NotAllowedError')), false)
})

test('不正JSONと未対応バージョンを初期データで上書きしない', async () => {
  for (const raw of ['{broken', JSON.stringify({ schemaVersion: 99 })]) {
    const disk = memoryDisk(); disk.files.set('data.json', raw)
    const store = new FileStore(disk.directory, disk.lock)
    await assert.rejects(store.load())
    await assert.rejects(store.save(emptyState))
    assert.equal(disk.files.get('data.json'), raw)
  }
})

test('書き込み失敗は元データ・入力スナップショットを保持し、後続の自動保存を停止', async () => {
  const { disk, store } = await fixture()
  const original = disk.files.get('data.json')
  const memory = changed('保持する変更')
  disk.fail((stage, path) => { if (stage === 'write' && path === 'data.json') throw new Error('disk full') })
  const first = store.save(memory)
  const second = store.save(changed('後続'))
  await assert.rejects(first)
  await assert.rejects(second, /自動保存を停止/)
  assert.equal(memory.tasks[0].title, '保持する変更')
  assert.equal(disk.files.get('data.json'), original)
  assert.equal(disk.events.filter(([event, path]) => event === 'abort' && path === 'data.json').length, 1)
  disk.fail(() => {})
  await store.save(changed('最新'), true)
  assert.equal(diskDoc(disk).tasks[0].title, '最新')
})

test('バックアップ作成・書き込み・close失敗は正本更新を中止', async () => {
  for (const failStage of ['directory', 'write', 'close']) {
    const { disk, store } = await fixture()
    const original = disk.files.get('data.json')
    disk.fail((stage, path) => { if (stage === failStage && path.startsWith('backups/')) throw new Error('backup failure') })
    await assert.rejects(store.save(changed('保存しない')))
    assert.equal(disk.files.get('data.json'), original)
  }
})

test('正常バックアップから復元し、復元前データも保護してrevisionを増やす', async () => {
  const { disk, store } = await fixture()
  await store.save(changed('復元前'))
  const before = disk.files.get('data.json')
  const { names } = await store.listBackups()
  const restored = await store.restore(names[0])
  assert.equal(restored.revision, 3)
  assert.deepEqual(toState(restored), initialState)
  assert.ok([...disk.files.entries()].some(([name, value]) => name.startsWith('backups/') && value === before))
})

test('破損したバックアップとパストラバーサルを拒否', async () => {
  const { disk, store } = await fixture()
  await store.save(changed('現在'))
  const original = disk.files.get('data.json')
  const { names } = await store.listBackups()
  disk.files.set('backups/' + names[0], '{}')
  await assert.rejects(store.restore(names[0]))
  await assert.rejects(store.restore('../data.json'))
  assert.equal(disk.files.get('data.json'), original)
})

test('破損した正本を退避して復元、退避失敗なら破損正本も変更しない', async () => {
  const { disk, store } = await fixture()
  await store.save(changed('現在'))
  const { names } = await store.listBackups()
  disk.files.set('data.json', '{broken')
  const reopened = new FileStore(disk.directory, disk.lock)
  await assert.rejects(reopened.load())
  disk.fail((stage, path) => { if (stage === 'write' && path.startsWith('recovery/')) throw new Error('cannot preserve') })
  await assert.rejects(reopened.restore(names[0]))
  assert.equal(disk.files.get('data.json'), '{broken')
  disk.fail(() => {})
  await reopened.restore(names[0])
  assert.ok([...disk.files.entries()].some(([name, value]) => name.startsWith('recovery/') && value === '{broken'))
  assert.deepEqual(toState(diskDoc(disk)), initialState)
})

test('同じrevisionを読み込んだ2セッションの保存を調停し、後続は競合で拒否', async () => {
  const { disk, store } = await fixture()
  const other = new FileStore(disk.directory, disk.lock)
  await other.load()
  const results = await Promise.allSettled([store.save(changed('先行')), other.save(changed('後続'))])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  assert.equal(results[1].reason.code, 'conflict')
  assert.equal(diskDoc(disk).tasks[0].title, '先行')
})

test('revisionを変えない外部変更、バックアップ中の変更も拒否', async () => {
  for (const duringBackup of [false, true]) {
    const { disk, store } = await fixture()
    const external = serialize(changed('外部変更'), 1)
    if (duringBackup) disk.on((stage, path) => { if (stage === 'close' && path.startsWith('backups/')) disk.files.set('data.json', external) })
    else disk.files.set('data.json', external)
    await assert.rejects(store.save(changed('内部変更')), error => error.code === 'conflict')
    assert.equal(disk.files.get('data.json'), external)
  }
})

test('短時間の連続編集は直列で保存、最終revisionと最終データが一致', async () => {
  const { disk, store } = await fixture()
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.save(changed(`変更${i}`))))
  assert.equal(diskDoc(disk).revision, 21)
  assert.equal(diskDoc(disk).tasks[0].title, '変更19')
  assert.equal((await store.listBackups()).names.length, 20)
})

test('完全スキーマはID・参照・必須項目・上限・未知フィールドを拒否', () => {
  const base = JSON.parse(serialize(initialState, 1))
  for (const modify of [
    d => { d.tasks[0].id = d.people[0].id },
    d => { d.tasks[0].project = 'missing' },
    d => { d.tasks[5].owner = 'missing' },
    d => { d.questions[0].person = 'missing' },
    d => { delete d.tasks[0].url },
    d => { delete d.projects[0].archived },
    d => { d.revision = 0 },
    d => { d.extra = true },
    d => { d.tasks[0].due = '2026-02-30' },
    d => { d.people[0].name = 'x'.repeat(201) },
    d => { d.tasks[0].url = 'javascript:alert(1)' },
    d => { d.people = Array.from({ length: MAX_RECORDS + 1 }, (_, i) => ({ id: `p-${i}`, name: 'test' })) },
  ]) {
    const doc = structuredClone(base); modify(doc)
    assert.throws(() => parseDocument(JSON.stringify(doc)))
  }
  assert.throws(() => parseDocument(' '.repeat(MAX_BYTES + 1)))
})

test('書き込み後の検証に失敗してもバックアップを保持し、無言で再上書きしない', async () => {
  const { disk, store } = await fixture()
  disk.on((stage, path) => { if (stage === 'close' && path === 'data.json') disk.files.set('data.json', '{}') })
  await assert.rejects(store.save(changed('検証失敗')))
  assert.equal((await store.listBackups()).names.length, 1)
  disk.on(() => {})
  await assert.rejects(store.save(changed('再試行'), true), error => error.code === 'conflict')
})

test('正本が消えた場合、既存セッションは新規作成して上書きしない', async () => {
  const { disk, store } = await fixture()
  disk.files.delete('data.json')
  await assert.rejects(store.save(initialState), error => error.code === 'conflict')
  assert.equal(disk.files.has('data.json'), false)
})

test('リポジトリ直下と不明なバックアップ名を拒否・除外', async () => {
  const disk = memoryDisk()
  disk.dirs.add('.git/')
  await assert.rejects(rejectRepository(disk.directory))
  disk.dirs.add('backups/')
  disk.files.set('backups/other.json', '{}')
  const store = new FileStore(disk.directory, disk.lock)
  assert.deepEqual(await store.listBackups(), { names: [], truncated: false })
})

test('選択後のAbortErrorをキャンセル扱いにせず、書き込み失敗として伝える', async () => {
  assert.equal(cancelled(new DOMException('', 'AbortError'), false), false)
  const { disk, store } = await fixture()
  const original = disk.files.get('data.json')
  disk.fail((stage, path) => { if (stage === 'close' && path === 'data.json') throw new DOMException('', 'AbortError') })
  await assert.rejects(store.save(changed('中断')), error => error.name === 'AbortError')
  assert.equal(disk.files.get('data.json'), original)
  await assert.rejects(store.save(changed('後続')), /自動保存を停止/)
})

test('複数URLを形式2で保存し、形式1の原本バックアップと双方向の復元を維持する', async () => {
  const { disk, store } = await fixture()
  const original = disk.files.get('data.json')
  assert.equal(parseDocument(original).schemaVersion, 1)
  const next = { ...initialState, tasks: initialState.tasks.map((task, i) => i === 0 ? { ...task, url: ['https://example.com/a', 'https://example.com/b'] } : task) }
  await store.save(next)
  const multi = diskDoc(disk)
  assert.equal(multi.schemaVersion, 2)
  assert.deepEqual(multi.tasks[0].url, next.tasks[0].url)
  const restarted = new FileStore(disk.directory, disk.lock)
  assert.deepEqual(toState(await restarted.load()), next)
  const before = [...disk.files.entries()].find(([name, text]) => name.startsWith('backups/') && text === original)
  assert.ok(before)
  await restarted.restore(before[0].slice('backups/'.length))
  assert.equal(diskDoc(disk).schemaVersion, 1)
  const multiBackup = [...disk.files.entries()].find(([name, text]) => name.startsWith('backups/') && parseDocument(text).schemaVersion === 2)
  assert.ok(multiBackup)
  await restarted.restore(multiBackup[0].slice('backups/'.length))
  assert.deepEqual(diskDoc(disk).tasks[0].url, next.tasks[0].url)
})
test('形式1への複数URL混入・未知形式・不正URL配列を拒否する', () => {
  const doc = JSON.parse(serialize(initialState, 1))
  doc.tasks[0].url = ['https://example.com/a', 'https://example.com/b']
  assert.throws(() => parseDocument(JSON.stringify(doc)))
  doc.schemaVersion = 2
  assert.equal(parseDocument(JSON.stringify(doc)).schemaVersion, 2)
  doc.tasks[0].url[1] = 'data:text/html,test'
  assert.throws(() => parseDocument(JSON.stringify(doc)))
  doc.schemaVersion = 99
  assert.throws(() => parseDocument(JSON.stringify(doc)), /未対応/)
})


test('関係者ラベルを形式3で保存・再読込し、旧形式と相互にバックアップ復元できる', async () => {
  const { disk, store } = await fixture()
  const original = disk.files.get('data.json')
  const next = { ...initialState, people: initialState.people.map((person, i) => i === 0 ? { ...person, labels: ['チーム外', '営業'] } : person) }
  await store.save(next)
  assert.equal(diskDoc(disk).schemaVersion, 3)
  const restarted = new FileStore(disk.directory, disk.lock)
  assert.deepEqual(toState(await restarted.load()), next)
  const before = [...disk.files.entries()].find(([name, text]) => name.startsWith('backups/') && text === original)
  assert.ok(before)
  await restarted.restore(before[0].slice('backups/'.length))
  assert.equal(diskDoc(disk).schemaVersion, 1)
  const labeledBackup = [...disk.files.entries()].find(([name, text]) => name.startsWith('backups/') && parseDocument(text).schemaVersion === 3)
  assert.ok(labeledBackup)
  await restarted.restore(labeledBackup[0].slice('backups/'.length))
  assert.deepEqual(toState(diskDoc(disk)), next)
})

test('旧形式へのラベル混入・不正ラベル・重複ラベルを拒否する', () => {
  const doc = JSON.parse(serialize(initialState, 1))
  doc.people[0].labels = ['営業']
  for (const version of [1, 2]) {
    doc.schemaVersion = version
    assert.throws(() => parseDocument(JSON.stringify(doc)))
  }
  doc.schemaVersion = 3
  assert.deepEqual(parseDocument(JSON.stringify(doc)).people[0].labels, ['営業'])
  for (const labels of [['営業', '営業'], ['不明'], '営業', Array(5).fill('先輩')]) {
    doc.people[0].labels = labels
    assert.throws(() => parseDocument(JSON.stringify(doc)))
  }
})


test('容量不足でバックアップに失敗すると正本と未保存スナップショットを維持する', async () => {
  const { disk, store } = await fixture()
  const original = disk.files.get('data.json')
  const next = changed('容量不足テスト')
  disk.fail((stage, path) => { if (stage === 'write' && path.startsWith('backups/')) throw new DOMException('dummy', 'QuotaExceededError') })
  await assert.rejects(store.save(next), error => error.name === 'QuotaExceededError')
  assert.equal(disk.files.get('data.json'), original)
  assert.equal(next.tasks[0].title, '容量不足テスト')
  await assert.rejects(store.save(changed('後続')), /自動保存を停止/)
  disk.fail(() => {})
  await store.save(next, true)
  assert.equal(diskDoc(disk).tasks[0].title, next.tasks[0].title)
})

test('空フォルダへの2セッション同時作成でも後続を競合として拒否', async () => {
  const disk = memoryDisk()
  const first = new FileStore(disk.directory, disk.lock)
  const second = new FileStore(disk.directory, disk.lock)
  assert.equal(await first.load(), null)
  assert.equal(await second.load(), null)
  const result = await Promise.allSettled([first.save(changed('先行')), second.save(changed('後続'))])
  assert.equal(result[0].status, 'fulfilled')
  assert.equal(result[1].status, 'rejected')
  assert.equal(result[1].reason.code, 'conflict')
  assert.equal(diskDoc(disk).tasks[0].title, '先行')
})

test('大量バックアップ一覧は走査上限で止まり、ファイルを削除しない', async () => {
  const { disk, store } = await fixture()
  disk.dirs.add('backups/')
  for (let i = 0; i < 2001; i++) disk.files.set(`backups/backup-2026-10-15T00-00-00-000Z-${crypto.randomUUID()}.json`, '{}')
  const before = new Map(disk.files)
  const result = await store.listBackups()
  assert.equal(result.truncated, true)
  assert.equal(result.names.length, 2000)
  assert.deepEqual(disk.files, before)
  await assert.rejects(store.restore(result.names[0]))
  assert.deepEqual(disk.files, before)
})

test('schemaVersion 4の拡張・順序・確認事項移行を保存し、旧版バックアップから復元する', async () => {
  const { applyAction } = await import('../src/data.ts')
  const { disk, store } = await fixture()
  const original = disk.files.get('data.json')
  let next = applyAction(initialState, { type: 'migrateNotes' })
  next = { ...next, people: [...next.people].reverse().map((p, i) => i === 0 ? { ...p, labels: ['設計', '顧客窓口'] } : p), projects: next.projects.map((p, i) => i === 1 ? { ...p, parentId: 'p1', color: 'green' } : p), tasks: next.tasks.map((t, i) => i === 0 ? { ...t, project: 'p1', projects: ['p1', 'p2'] } : t) }
  await store.save(next)
  const saved = diskDoc(disk)
  assert.equal(saved.schemaVersion, 4)
  assert.deepEqual(saved.questions, [])
  assert.deepEqual(saved.people.map(p => p.id), next.people.map(p => p.id))
  assert.deepEqual(saved.tasks[0].projects, ['p1', 'p2'])
  assert.equal(saved.projects[1].parentId, 'p1')
  assert.equal(saved.projects[1].color, 'green')
  const restarted = new FileStore(disk.directory, disk.lock)
  assert.deepEqual(await restarted.load(), saved)
  const backup = [...disk.files.entries()].find(([path, text]) => path.startsWith('backups/') && text === original)[0].split('/').at(-1)
  await store.restore(backup)
  assert.equal(diskDoc(disk).schemaVersion, 1)
  assert.deepEqual(diskDoc(disk).questions, parseDocument(original).questions)
})

test('schemaVersion 4も不正なラベル・親子関係・関連参照を読み込み時に拒否する', () => {
  const base = parseDocument(serialize(initialState, 1))
  base.schemaVersion = 4
  for (const mutate of [
    d => { d.people[0].labels = ['重複', '重複'] },
    d => { d.people[0].labels = [' '] },
    d => { d.people[0].labels = ['a'.repeat(41)] },
    d => { d.projects[0].parentId = d.projects[0].id },
    d => { d.projects[0].parentId = 'missing' },
    d => { d.projects[0].parentId = 'p2'; d.projects[1].parentId = 'p1' },
    d => { d.tasks[0].relatedPeople = ['missing'] },
    d => { d.tasks[0].projects = ['p1', 'missing'] },
    d => { d.tasks[0].projects = ['p2'] },
  ]) {
    const doc = structuredClone(base); mutate(doc)
    assert.throws(() => parseDocument(JSON.stringify(doc)))
  }
  base.people[0].labels = ['任意のラベル']
  assert.deepEqual(parseDocument(JSON.stringify(base)).people[0].labels, ['任意のラベル'])
  base.schemaVersion = 3
  assert.throws(() => parseDocument(JSON.stringify(base)))
})
