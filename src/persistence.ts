import { z } from 'zod'
import { taskSchema, projectSchema, personSchema, noteSchema, taskUrlSchema, legacyPersonLabels, taskProjects, validateProjectTree } from './data.ts'
import type { WorkState } from './data.ts'

export const MAX_BYTES = 5 * 1024 * 1024
export const MAX_RECORDS = 10000
export const emptyState: WorkState = { projects: [], tasks: [], people: [], notes: [] }
const storedTasks = z.discriminatedUnion('kind', [
  taskSchema.options[0].extend({ url: taskUrlSchema, project: z.string().max(200) }),
  taskSchema.options[1].extend({ url: taskUrlSchema, project: z.string().max(200) }),
])
export const documentSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1),
  projects: z.array(projectSchema.extend({ archived: z.boolean() })).max(MAX_RECORDS),
  tasks: z.array(storedTasks).max(MAX_RECORDS),
  people: z.array(personSchema).max(MAX_RECORDS),
  questions: z.array(noteSchema.extend({ project: z.string().max(200) })).max(MAX_RECORDS),
}).strict().superRefine((data, ctx) => {
  if (data.schemaVersion === 1 && data.tasks.some(task => Array.isArray(task.url))) ctx.addIssue({ code: 'custom', message: '複数URLにはschemaVersion 2が必要です' })
  if (data.schemaVersion < 3 && data.people.some(person => person.labels !== undefined)) ctx.addIssue({ code: 'custom', message: '関係者ラベルにはschemaVersion 3が必要です' })
  if (data.schemaVersion < 4 && data.people.some(person => person.labels && (person.labels.length > 4 || person.labels.some(label => !legacyPersonLabels.includes(label))))) ctx.addIssue({ code: 'custom', message: '自由な関係者ラベルにはschemaVersion 4が必要です' })
  if (data.schemaVersion < 4 && (data.tasks.some(task => task.projects !== undefined || task.relatedPeople !== undefined) || data.projects.some(project => project.parentId !== undefined || project.color !== undefined))) ctx.addIssue({ code: 'custom', message: 'ラベル・関係者の拡張にはschemaVersion 4が必要です' })
  try { validateProjectTree(data.projects) } catch { ctx.addIssue({ code: 'custom', message: 'ラベルの親子関係が不正です' }) }
  const records = [...data.projects, ...data.tasks, ...data.people, ...data.questions]
  if (records.length > MAX_RECORDS) ctx.addIssue({ code: 'custom', message: 'レコード数の上限を超えています' })
  if (new Set(records.map(record => record.id)).size !== records.length) ctx.addIssue({ code: 'custom', message: 'IDが重複しています' })
  const projects = new Set(data.projects.map(p => p.id))
  const people = new Set(data.people.map(p => p.id))
  for (const record of [...data.tasks, ...data.questions]) {
    if (record.project && !projects.has(record.project)) ctx.addIssue({ code: 'custom', message: 'プロジェクトの参照が不正です' })
  }
  for (const task of data.tasks) {
    if (task.kind === 'delegated' && !people.has(task.owner)) ctx.addIssue({ code: 'custom', message: '担当者の参照が不正です' })
    if (taskProjects(task).some(id => !projects.has(id)) || (task.projects && task.project !== (task.projects[0] ?? ''))) ctx.addIssue({ code: 'custom', message: 'ラベルの参照が不正です' })
    if (task.relatedPeople?.some(id => !people.has(id))) ctx.addIssue({ code: 'custom', message: '関係者の参照が不正です' })
  }
  for (const question of data.questions) {
    if (!people.has(question.person)) ctx.addIssue({ code: 'custom', message: '確認相手の参照が不正です' })
  }
})
export type WorkDocument = z.infer<typeof documentSchema>
export class StorageError extends Error {
  code: 'invalid' | 'version' | 'conflict' | 'permission' | 'write' | 'blocked' | 'unsupported'
  constructor(code: StorageError['code'], message: string) { super(message); this.code = code }
}
export function parseDocument(text: string): WorkDocument {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new StorageError('invalid', 'ファイルサイズの上限（5 MiB）を超えています。')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new StorageError('invalid', 'JSONを読み込めません。正本は変更していません。') }
  if (value && typeof value === 'object' && 'schemaVersion' in value && ![1, 2, 3, 4].includes(Number(value.schemaVersion))) throw new StorageError('version', '未対応のschemaVersionです。自動変換は行いません。')
  const result = documentSchema.safeParse(value)
  if (!result.success) throw new StorageError('invalid', 'データの形式・上限・ID・参照関係が不正です。')
  return result.data
}
export const toState = (doc: WorkDocument): WorkState => ({ projects: doc.projects, tasks: doc.tasks, people: doc.people, notes: doc.questions })
export const needsV4 = (state: WorkState) => state.people.some(person => person.labels && (person.labels.length > 4 || person.labels.some(label => !legacyPersonLabels.includes(label)))) || state.tasks.some(task => task.projects !== undefined || task.relatedPeople !== undefined) || state.projects.some(project => project.parentId !== undefined || project.color !== undefined)
export const documentVersion = (state: WorkState) => needsV4(state) ? 4 : state.people.some(person => person.labels !== undefined) ? 3 : state.tasks.some(task => Array.isArray(task.url)) ? 2 : 1
export function serialize(state: WorkState, revision: number): string {
  const text = JSON.stringify({ schemaVersion: documentVersion(state), revision, projects: state.projects, tasks: state.tasks, people: state.people, questions: state.notes }, null, 2) + '\n'
  parseDocument(text)
  return text
}

// Minimal browser interfaces, also implemented by in-memory test doubles.
export interface LocalFile {
  getFile(): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> }>
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>
}
export interface LocalDirectory {
  name: string
  getFileHandle(name: string, options?: { create?: boolean }): Promise<LocalFile>
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<LocalDirectory>
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  isSameEntry(other: LocalDirectory): Promise<boolean>
  entries(): AsyncIterableIterator<[string, { kind: string }]>
}
export type Lock = <T>(job: () => Promise<T>) => Promise<T>
export const backupPattern = /^backup-\d{4}-\d{2}-\d{2}T[\d-]+Z-[\da-f-]{36}\.json$/
const isNotFound = (error: unknown) => error instanceof Error && error.name === 'NotFoundError'
export const cancelled = (error: unknown, pickerActive = true) => pickerActive && error instanceof Error && error.name === 'AbortError'
export function storageMessage(error: unknown): string {
  if (error instanceof StorageError) return error.message
  if (error instanceof Error && ['NotAllowedError', 'SecurityError'].includes(error.name)) return '保存権限がありません。同じ保存先フォルダを再選択してください。'
  return 'ファイル操作に失敗しました。変更はメモリに保持しています。権限と空き容量を確認してください。'
}
async function read(handle: LocalFile): Promise<string> {
  const file = await handle.getFile()
  if (file.size > MAX_BYTES) throw new StorageError('invalid', 'ファイルサイズの上限（5 MiB）を超えています。')
  const buffer = await file.arrayBuffer()
  if (buffer.byteLength > MAX_BYTES) throw new StorageError('invalid', 'ファイルサイズの上限を超えています。')
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer) } catch { throw new StorageError('invalid', 'UTF-8のJSONファイルではありません。手動で元ファイルを退避してください。') }
}
async function writeVerified(handle: LocalFile, text: string): Promise<void> {
  const stream = await handle.createWritable()
  try { await stream.write(text); await stream.close() } catch (error) {
    try { await stream.abort() } catch { /* Best effort; the source backup remains available. */ }
    throw error
  }
  if (await read(handle) !== text) throw new StorageError('write', '書き込み後の確認に失敗しました。自動保存を停止しました。')
}

export class FileStore {
  directory: LocalDirectory
  private lock: Lock
  private baseline: string | null | undefined
  private tail: Promise<unknown> = Promise.resolve()
  private stopped = false
  constructor(directory: LocalDirectory, lock: Lock) { this.directory = directory; this.lock = lock }
  private async current(): Promise<string | null> {
    try { return await read(await this.directory.getFileHandle('data.json')) } catch (error) { if (isNotFound(error)) return null; throw error }
  }
  async load(): Promise<WorkDocument | null> {
    this.baseline = await this.current()
    return this.baseline === null ? null : parseDocument(this.baseline)
  }
  private async permission() {
    if (await this.directory.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new StorageError('permission', '保存権限がありません。同じ保存先フォルダを再選択してください。')
  }
  private async unchanged() {
    if (this.baseline === undefined) throw new StorageError('blocked', '正本を読み込めていません。フォルダを再選択してください。')
    const current = await this.current()
    if (current !== this.baseline) throw new StorageError('conflict', '他のタブまたは外部アプリによる変更を検知しました。上書きせず停止しました。')
    return current
  }
  private enqueue<T>(job: () => Promise<T>, retry: boolean): Promise<T> {
    const result = this.tail.then(() => this.lock(async () => {
      if (this.stopped && !retry) throw new StorageError('blocked', '保存失敗後の自動保存を停止しています。再試行してください。')
      try { const value = await job(); this.stopped = false; return value } catch (error) { this.stopped = true; throw error }
    })).catch(error => { this.stopped = true; throw error })
    this.tail = result.catch(() => undefined)
    return result
  }
  private async protect(text: string, valid: boolean) {
    const directory = await this.directory.getDirectoryHandle(valid ? 'backups' : 'recovery', { create: true })
    const name = `${valid ? 'backup' : 'invalid'}-${new Date().toISOString().replaceAll(':', '-').replace('.', '-')}-${crypto.randomUUID()}.json`
    // UUIDs plus an existence check prevent intentional reuse of an existing backup.
    try { await directory.getFileHandle(name); throw new StorageError('write', '退避ファイル名が重複しました。') } catch (error) { if (!isNotFound(error)) throw error }
    if (valid) parseDocument(text)
    await writeVerified(await directory.getFileHandle(name, { create: true }), text)
  }
  private async update(state: WorkState, restoring: boolean, minimumRevision = 0): Promise<WorkDocument> {
    await this.permission()
    const old = await this.unchanged()
    let revision = minimumRevision
    let valid = false
    if (old !== null) {
      try { revision = Math.max(revision, parseDocument(old).revision); valid = true } catch (error) { if (!restoring) throw error }
    }
    const text = serialize(state, revision + 1)
    if (old !== null) await this.protect(old, valid)
    // Recheck after the backup, immediately before opening the write stream.
    await this.unchanged()
    await writeVerified(await this.directory.getFileHandle('data.json', { create: true }), text)
    this.baseline = text
    return parseDocument(text)
  }
  save(state: WorkState, retry = false): Promise<WorkDocument> {
    // Snapshot at the edit boundary; later UI changes cannot mutate queued writes.
    const snapshot = toState(parseDocument(serialize(state, 1)))
    return this.enqueue(() => this.update(snapshot, false), retry)
  }
  async listBackups(): Promise<{ names: string[]; truncated: boolean }> {
    let directory: LocalDirectory
    try { directory = await this.directory.getDirectoryHandle('backups') } catch (error) { if (isNotFound(error)) return { names: [], truncated: false }; throw error }
    const names: string[] = []
    let count = 0
    for await (const [name, handle] of directory.entries()) {
      if (++count > 2000) return { names: names.sort().reverse(), truncated: true }
      if (handle.kind === 'file' && backupPattern.test(name)) names.push(name)
    }
    return { names: names.sort().reverse(), truncated: false }
  }
  restore(name: string): Promise<WorkDocument> {
    if (!backupPattern.test(name)) return Promise.reject(new StorageError('invalid', 'バックアップ名が不正です。'))
    return this.enqueue(async () => {
      const directory = await this.directory.getDirectoryHandle('backups')
      const doc = parseDocument(await read(await directory.getFileHandle(name)))
      return this.update(toState(doc), true, doc.revision)
    }, true)
  }
}

export type PickerWindow = Window & { showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<LocalDirectory> }
export function browserLock(): Lock {
  if (!navigator.locks) throw new StorageError('unsupported', 'Web Locks APIが利用できないため、保存は無効です。Chromeを使用してください。')
  // One origin-wide lock intentionally covers all Worklane folders.
  return job => navigator.locks.request('worklane-json-write-v1', { mode: 'exclusive' }, job)
}
export async function rejectRepository(directory: LocalDirectory) {
  for (const marker of ['.git', 'node_modules']) {
    try { await directory.getDirectoryHandle(marker); throw new StorageError('blocked', 'ソースのルートではなく、Git除外対象のdataフォルダを選択してください。') } catch (error) { if (!isNotFound(error)) throw error }
  }
  try { await directory.getFileHandle('package.json'); throw new StorageError('blocked', 'ソースのルートではなく、Git除外対象のdataフォルダを選択してください。') } catch (error) { if (!isNotFound(error)) throw error }
}
