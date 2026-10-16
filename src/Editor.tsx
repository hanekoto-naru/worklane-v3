import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { IconX, IconTrash, IconPlus } from '@tabler/icons-react'
import { z } from 'zod'
import { personLabels, personSchema, mineStatuses, delegatedStatuses, relatedUrls, taskSchema, shortDate } from './data'
import type { Task, Note, Project, Person, WorkState, WorkAction } from './data'
import s from './App.module.css'
import { Choice, Toggle } from './Choice'
import { nextChoiceIndex } from './selection'

function formSnapshot(form: HTMLFormElement | null) {
  return form ? JSON.stringify([...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[name],textarea[name]')].map(input => [input.name, input.value])) : ''
}

export type EditorValue = { kind: 'task'; value: Task } | { kind: 'note'; value: Note } | { kind: 'project'; value: Project } | { kind: 'person'; value: Person }
export default function Editor({ editor, state, commit, close, fileMode, readOnly, returnFocus }: {
  editor: EditorValue; state: WorkState; commit: (action: WorkAction) => void; close: () => void; fileMode: boolean; readOnly: boolean; returnFocus?: HTMLElement | null
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const initialForm = useRef('')
  const outsidePress = useRef(false)
  const initialUrls = editor.kind === 'task' ? relatedUrls(editor.value.url) : []
  const [urls, setUrls] = useState(() => (initialUrls.length ? initialUrls : ['']).map((value, id) => ({ id, value })))
  const nextUrlId = useRef(urls.length)
  const [due, setDue] = useState(editor.kind === 'task' || editor.kind === 'project' ? editor.value.due : '')
  const [nextCheck, setNextCheck] = useState(editor.kind === 'task' && editor.value.kind === 'delegated' ? editor.value.nextCheck : '')
  const changed = () => formSnapshot(formRef.current) !== initialForm.current
  const [labels, setLabels] = useState(editor.kind === 'person' ? editor.value.labels ?? [] : [])
  const [error, setError] = useState('')
  const { kind, value } = editor
  const existing = [...state.tasks, ...state.notes, ...state.projects, ...state.people].some(item => item.id === value.id)
  useEffect(() => {
    const opener = returnFocus ?? null
    initialForm.current = formSnapshot(formRef.current)
    dialog.current?.showModal()
    const warn = (event: BeforeUnloadEvent) => { if (formSnapshot(formRef.current) !== initialForm.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => { window.removeEventListener('beforeunload', warn); queueMicrotask(() => { if (opener?.isConnected) opener.focus(); else document.getElementById('main')?.focus() }) }
  }, [returnFocus])
  const dismiss = () => {
    if (!changed() || window.confirm('入力中の変更を破棄しますか？')) close()
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? '')
    try {
      const name = text('newPerson').trim()
      const person = name ? { id: crypto.randomUUID(), name } : undefined
      const enteredUrls = urls.map(row => row.value.trim()).filter(Boolean)
      let next: unknown
      if (kind === 'person') {
        next = { id: value.id, name: text('name'), ...(labels.length ? { labels } : {}) }
        personSchema.parse(next)
        if (labels.length && !state.people.some(person => person.labels !== undefined) && !window.confirm('関係者ラベルを保存すると保存形式が更新され、旧版では開けなくなります。既存ファイルは保存前にバックアップします。変更を反映しますか？')) return
      } else if (kind === 'project') {
        next = { ...value, name: text('name'), description: text('description'), due: text('due'), archived: form.has('archived') }
      } else if (kind === 'note') {
        next = { ...value, title: text('title'), detail: text('detail'), project: text('project'), person: person?.id ?? text('person'), checked: form.has('checked') }
      } else {
        next = { ...value, title: text('title'), detail: text('detail'), project: text('project'), due: text('due'), priority: text('priority'), status: text('status'), url: enteredUrls.length > 1 ? enteredUrls : (enteredUrls[0] ?? ''), ...(editor.kind === 'task' && editor.value.kind === 'delegated' ? { owner: person?.id ?? text('person'), nextCheck: text('nextCheck') } : {}) }
      }
      if (kind === 'task') {
        const validated = taskSchema.parse(next)
        if (Array.isArray(validated.url) && !state.people.some(person => person.labels !== undefined) && !state.tasks.some(task => Array.isArray(task.url)) && !window.confirm('複数URLを保存すると保存形式が更新され、旧版では開けなくなります。既存ファイルは保存前にバックアップします。変更を反映しますか？')) return
      }
      commit({ type: 'put', kind, value: next, person })
      close()
    } catch (err) {
      setError(err instanceof z.ZodError ? err.issues.map(issue => `${({ title: 'タイトル', name: '名前', due: '期限', nextCheck: '次回確認日', person: '確認相手', owner: '担当者', url: '関連URL' } as Record<string, string>)[String(issue.path[0])] ?? '入力値'}: ${issue.message}`).join(' / ') : err instanceof Error ? err.message : '変更を反映できませんでした')
    }
  }
  const task = editor.kind === 'task' ? editor.value : null
  const note = editor.kind === 'note' ? editor.value : null
  const contact = editor.kind === 'person' ? editor.value : null
  const project = editor.kind === 'project' ? editor.value : null
  return <dialog ref={dialog} className={s.editor} onCancel={event => { event.preventDefault(); dismiss() }} aria-labelledby="editor-title"
    onPointerDown={event => {
      const rect = event.currentTarget.getBoundingClientRect()
      outsidePress.current = event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
    }}
    onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect()
      const outside = event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
      if (outsidePress.current && outside && !changed()) close()
      outsidePress.current = false
    }}>
    <form ref={formRef} onSubmit={submit}>
      <div className={s.sectionHeading}><h2 id="editor-title">{existing ? '編集' : '新規登録'}：{task ? task.kind === 'mine' ? '自分のタスク' : '依頼したタスク' : note ? '確認事項' : contact ? '関係者' : '目標・施策'}</h2><button type="button" onClick={dismiss} aria-label="編集モーダルを閉じる"><IconX size={19} /></button></div>
      <p className={s.sectionDescription}>{fileMode ? '登録・変更の反映後に自動保存します。保存状態を確認してください。' : '保存先未選択。変更は画面内のみ保持され、再読み込みで消えます。'}</p>
      {readOnly && <p className={s.error}>読み取り専用です。保存状態を確認してください。</p>}
      {error && <p className={s.error} role="alert">{error}</p>}
      <label>{project ? '目標・施策名' : contact ? '名前' : 'タイトル'}（必須）<input name={project || contact ? 'name' : 'title'} defaultValue={project?.name ?? contact?.name ?? task?.title ?? note?.title} required maxLength={200} autoFocus /></label>
      {contact && <fieldset><legend>関係者ラベル（複数選択）</legend>
        <input type="hidden" name="labels" value={labels.join(',')} />
        <div className={s.choiceButtons} onKeyDown={event => {
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
          const next = nextChoiceIndex(buttons.indexOf(event.target as HTMLButtonElement), buttons.length, event.key)
          if (next !== null) { event.preventDefault(); buttons[next]?.focus() }
        }}>{personLabels.map(label => <button type="button" key={label} aria-pressed={labels.includes(label)} disabled={readOnly} onClick={() => setLabels(current => current.includes(label) ? current.filter(value => value !== label) : [...current, label])}>{labels.includes(label) ? '✓ ' : ''}{label}</button>)}</div>
      </fieldset>}
      {!contact && <label>{project ? '説明' : '詳細説明'}<textarea name={project ? 'description' : 'detail'} defaultValue={project?.description ?? task?.detail ?? note?.detail} maxLength={10000} rows={4} /></label>}
      {task && <><Choice label="ステータス" name="status" defaultValue={task.status} options={(task.kind === 'mine' ? mineStatuses : delegatedStatuses).map(value => ({ value, label: value }))} icon="status" disabled={readOnly} /><Choice label="優先度" name="priority" defaultValue={task.priority} options={['なし', '低', '中', '高'].map(value => ({ value, label: value }))} icon="priority" disabled={readOnly} /></>}

      {(task || project) && <label>期限<input type="date" name="due" value={due} onChange={e => setDue(e.target.value)} /><small aria-live="polite">{shortDate(due, true)}</small></label>}
      {task?.kind === 'delegated' && <label>次回確認日<input type="date" name="nextCheck" value={nextCheck} onChange={e => setNextCheck(e.target.value)} /><small aria-live="polite">{shortDate(nextCheck, true)}</small></label>}
      {(task?.kind === 'delegated' || note) && <fieldset><legend>{note ? '確認相手' : '担当者'}（選択または新規登録・必須）</legend><Choice label="登録済みの相手" name="person" defaultValue={note?.person ?? task?.owner} options={[{ value: '', label: '未選択' }, ...state.people.map(person => ({ value: person.id, label: person.name }))]} disabled={readOnly} /><label>新しい相手の名前<input name="newPerson" maxLength={200} placeholder="新規登録する場合のみ入力" /></label><small>名前を入力すると、登録してこの業務に設定します。</small></fieldset>}
      {(task || note) && <Choice label="目標・施策" name="project" defaultValue={task?.project ?? note?.project} options={[{ value: '', label: '未分類' }, ...state.projects.filter(p => !p.archived || p.id === (task?.project ?? note?.project)).map(p => ({ value: p.id, label: p.name + (p.archived ? '（アーカイブ済み）' : '') }))]} disabled={readOnly} />}

      {task && <fieldset ><legend>関連URL</legend>
        {urls.map((row, index) => <div className={s.urlRow} key={row.id}>
          <label>URL {index + 1}<input name="url" value={row.value} maxLength={2048} placeholder="https://example.com" disabled={readOnly} onChange={event => setUrls(current => current.map(item => item.id === row.id ? { ...item, value: event.target.value } : item))} /></label>
          <button className={s.iconButton} type="button" disabled={readOnly || (urls.length === 1 && !row.value)} aria-label={`URL ${index + 1}を削除`} onClick={() => setUrls(current => current.length === 1 ? [{ ...current[0], value: '' }] : current.filter(item => item.id !== row.id))}><IconX size={18} /></button>
        </div>)}
        <button className={s.textButton} type="button" disabled={readOnly || urls.length >= 10} onClick={() => { const id = nextUrlId.current++; setUrls(current => [...current, { id, value: '' }]) }}><IconPlus size={16} />URLを追加</button>
        <p className={s.fieldHelp}>最大10件。登録・表示のみ。外部サイトは開きません。</p>
      </fieldset>}
      {note && <Toggle label="確認済み" name="checked" defaultChecked={note.checked} disabled={readOnly} />}
      {project && <Toggle label="アーカイブ（関連業務は保持）" name="archived" defaultChecked={project.archived} disabled={readOnly} />}
      <div className={s.formActions}>{existing && (kind === 'task' || kind === 'note') && <button className={s.dangerButton} disabled={readOnly} type="button" onClick={() => {
        if (!window.confirm(`${kind === 'task' ? 'タスク' : '確認事項'}を削除しますか？`)) return
        try { commit({ type: 'delete', kind, id: value.id }); close() } catch { setError('削除できませんでした') }
      }}><IconTrash size={16} />削除</button>}<button type="button" onClick={dismiss}>キャンセル</button><button className={s.primaryButton} disabled={readOnly} type="submit">{existing ? '変更を反映' : '登録'}</button></div>
    </form>
  </dialog>
}
