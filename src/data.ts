import { z } from 'zod'

// Avoid dynamic-code probes and JIT compilation under the production CSP.
z.config({ jitless: true })

const required = z.string().trim().min(1, '入力してください').max(200, '200文字以内で入力してください')
const detail = z.string().max(10000, '10000文字以内で入力してください')
const date = z.union([z.literal(''), z.iso.date('有効な日付を入力してください')])
export const mineStatuses = ['未着手', '進行中', '保留', '完了'] as const
export const delegatedStatuses = ['依頼済み', '対応中', 'レビュー待ち', '完了'] as const
export const urlSchema = z.string().trim().max(2048).refine(value => {
  if (!value) return true
  if ([...value].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) || value.includes('\\')) return false
  try {
    if (/%(?![0-9a-f]{2})|%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) return false
    const authority = value.split('/')[2] ?? ''
    if (authority.includes('%')) return false
    const url = new URL(value)
    return /^https?:\/\//i.test(value) && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
  } catch { return false }
}, '関連URLは認証情報を含まないhttpまたはhttpsのURLを入力してください')
export const taskUrlSchema = z.union([urlSchema, z.array(urlSchema.refine(value => value.length > 0, 'URLを入力してください')).min(2).max(10, '関連URLは10件までです')])
export const relatedUrls = (url: string | string[]) => Array.isArray(url) ? url : url ? [url] : []
export const personLabels = ['チーム外', '営業'] as const
// Preserve stored labels without offering them for new selections.
const storedPersonLabels = ['先輩', '後輩', ...personLabels] as const
export const personSchema = z.object({ id: required, name: required, labels: z.array(z.enum(storedPersonLabels)).max(4).refine(values => new Set(values).size === values.length, 'ラベルが重複しています').optional() }).strict()
export const projectSchema = z.object({ id: required, name: required, description: detail, due: date, archived: z.boolean().default(false) }).strict()
const taskFields = {
  id: required, title: required, detail, priority: z.enum(['なし', '高', '中', '低']),
  due: date, project: z.string(), url: taskUrlSchema.default(''),
}
export const taskSchema = z.discriminatedUnion('kind', [
  z.object({ ...taskFields, kind: z.literal('mine'), status: z.enum(mineStatuses), owner: z.literal('自分') }).strict(),
  z.object({ ...taskFields, kind: z.literal('delegated'), status: z.enum(delegatedStatuses), owner: required, nextCheck: date }).strict(),
])
export const noteSchema = z.object({ id: required, title: required, detail, person: required, project: z.string(), checked: z.boolean() }).strict()
export type Task = z.infer<typeof taskSchema>
export type Note = z.infer<typeof noteSchema>
export type Project = z.infer<typeof projectSchema>
export type Person = z.infer<typeof personSchema>
export function shortDate(value: string, year = false) {
  if (!value || !z.iso.date().safeParse(value).success) return '—'
  const day = new Date(value + 'T12:00:00Z').getUTCDay()
  return `${year ? value.slice(0, 4) + '/' : ''}${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}（${'日月火水木金土'[day]}）`
}

export type WorkState = { tasks: Task[]; notes: Note[]; projects: Project[]; people: Person[] }
export const initialState: WorkState = { tasks: [], notes: [], projects: [], people: [] }
export type RecordKind = 'task' | 'note' | 'project' | 'person'
export type WorkAction =
  | { type: 'put'; kind: RecordKind; value: unknown; person?: Person }
  | { type: 'delete'; kind: 'task' | 'note'; id: string }

// All mutations are validated here; this module has no persistence or UI dependency.
export function applyAction(state: WorkState, action: WorkAction): WorkState {
  if (action.type === 'delete') {
    const key = action.kind === 'task' ? 'tasks' : 'notes'
    if (!state[key].some(item => item.id === action.id)) throw new Error('対象が見つかりません')
    return { ...state, [key]: state[key].filter(item => item.id !== action.id) }
  }
  const next = { ...state, people: [...state.people] }
  if (action.person) {
    const person = personSchema.parse(action.person)
    if ([...next.people, ...next.tasks, ...next.notes, ...next.projects].some(p => p.id === person.id) || next.people.some(p => p.name === person.name)) throw new Error('同じ名前の相手が登録されています。選択してください。')
    next.people.push(person)
  }
  const value = action.kind === 'task' ? taskSchema.parse(action.value) : action.kind === 'note' ? noteSchema.parse(action.value) : action.kind === 'person' ? personSchema.parse(action.value) : projectSchema.parse(action.value)
  const key = action.kind === 'task' ? 'tasks' : action.kind === 'note' ? 'notes' : action.kind === 'person' ? 'people' : 'projects'
  if (action.kind === 'person' && 'name' in value && next.people.some(p => p.id !== value.id && p.name === value.name)) throw new Error('同じ名前の相手が登録されています')
  for (const other of ['tasks', 'notes', 'projects', 'people'] as const) {
    if (other !== key && next[other].some(item => item.id === value.id)) throw new Error('IDが重複しています')
  }
  if ('project' in value && value.project && !next.projects.some(p => p.id === value.project)) throw new Error('プロジェクトが見つかりません')
  const personId = 'person' in value ? value.person : 'kind' in value && value.kind === 'delegated' ? value.owner : ''
  if (personId && !next.people.some(p => p.id === personId)) throw new Error('担当者・確認相手が見つかりません')
  if ('kind' in value) {
    const previous = next.tasks.find(t => t.id === value.id)
    if (previous && previous.kind !== value.kind) throw new Error('タスクの種類は変更できません')
  }
  return { ...next, [key]: [...next[key].filter(item => item.id !== value.id), value] }
}
export function projectCounts(state: WorkState, id: string) {
  const tasks = state.tasks.filter(t => t.project === id)
  const notes = state.notes.filter(n => n.project === id)
  const total = tasks.length + notes.length
  const done = tasks.filter(t => t.status === '完了').length + notes.filter(n => n.checked).length
  return { total, done, open: total - done }
}
export const priorityOrder = { '高': 0, '中': 1, '低': 2, 'なし': 3 }
export function sortTasks(rows: Task[], order: string) {
  return [...rows].sort((a, b) => (order === 'title' ? a.title.localeCompare(b.title, 'ja') : order === 'priority' ? priorityOrder[a.priority] - priorityOrder[b.priority] : (a.due || '9999').localeCompare(b.due || '9999')) || a.id.localeCompare(b.id))
}
