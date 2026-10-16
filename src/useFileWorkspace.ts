import { useEffect, useRef, useState } from 'react'
import { applyAction, initialState } from './data'
import type { WorkAction, WorkState } from './data'
import { FileStore, StorageError, browserLock, cancelled, emptyState, rejectRepository, serialize, storageMessage, toState } from './persistence'
import type { PickerWindow } from './persistence'

type SaveStatus = '未保存' | '保存中' | '保存済み' | '保存失敗'
export function useFileWorkspace() {
  const [state, setState] = useState(initialState)
  const current = useRef(state)
  const store = useRef<FileStore | null>(null)
  const generation = useRef(0)
  const dirty = useRef(false)
  const failure = useRef<unknown>(null)
  const operation = useRef(false)
  const pending = useRef(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const readOnlyRef = useRef(false)
  const [status, setStatus] = useState<SaveStatus>('未保存')
  const [message, setMessage] = useState('保存先が未選択です。変更は再読み込みで消えます。')
  const [folder, setFolder] = useState('')
  const [backups, setBackups] = useState<string[]>([])
  const [truncated, setTruncated] = useState(false)
  const supported = window.isSecureContext && typeof (window as PickerWindow).showDirectoryPicker === 'function' && !!navigator.locks
  function replace(next: WorkState) { current.current = next; setState(next) }
  function freeze(value: boolean) { readOnlyRef.current = value; setReadOnly(value) }
  function begin() { operation.current = true; setBusy(true) }
  function end() { operation.current = false; setBusy(false) }
  function failed(error: unknown) {
    dirty.current = true
    failure.current = error
    setStatus('保存失敗')
    setMessage(storageMessage(error))
    if (error instanceof StorageError && ['conflict', 'invalid', 'version'].includes(error.code)) freeze(true)
  }
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current || pending.current > 0 || operation.current) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  function save(next: WorkState, retry = false) {
    const target = store.current
    if (!target) return
    const ticket = generation.current
    pending.current++
    setPendingCount(pending.current)
    setStatus('保存中')
    setMessage('data.jsonに保存しています。')
    // Promise.resolve catches synchronous snapshot-validation failures too.
    void Promise.resolve().then(() => target.save(next, retry)).then(() => {
      if (ticket === generation.current) {
        dirty.current = false
        setStatus('保存済み')
        setMessage('data.jsonへの書き込みを確認しました。')
      }
    }).catch(error => { if (!failure.current) failed(error) }).finally(() => {
      pending.current--
      setPendingCount(pending.current)
    })
  }
  function commit(action: WorkAction) {
    if (operation.current || readOnlyRef.current) throw new Error('現在は読み取り専用です。保存状態を確認してください。')
    const next = applyAction(current.current, action)
    serialize(next, 1)
    replace(next)
    dirty.current = true
    generation.current++
    if (failure.current) {
      setStatus('保存失敗')
      setMessage('未保存の変更を保持しています。保存先を確認し、再試行してください。')
    } else if (store.current) save(next)
    else { setStatus('未保存'); setMessage('保存先が未選択です。変更は再読み込みで消えます。') }
  }
  function retry() {
    if (!store.current || operation.current || pending.current || readOnlyRef.current) return
    failure.current = null
    save(current.current, true)
  }
  async function selectFolder(copy = false) {
    if (!supported || operation.current || pending.current) return
    begin()
    let candidate: FileStore | null = null
    let picking = true
    try {
      const directory = await (window as PickerWindow).showDirectoryPicker!({ mode: 'readwrite' })
      picking = false
      await rejectRepository(directory)
      if (!copy && store.current && dirty.current && !readOnlyRef.current && await directory.isSameEntry(store.current.directory)) {
        store.current.directory = directory
        setMessage('保存先を再選択しました。「再試行」で未保存データを保存してください。')
        return
      }
      candidate = new FileStore(directory, browserLock())
      const doc = await candidate.load()
      if (copy && doc) throw new StorageError('blocked', '未保存データの保存先には、data.jsonがない専用フォルダを選択してください。')
      if (doc && dirty.current && !window.confirm('未保存の変更を破棄して、選択したフォルダのdata.jsonを読み込みますか？')) return
      let loaded = doc
      if (!loaded) {
        if (!window.confirm(copy ? '現在の画面のデータを、このフォルダのdata.jsonに保存しますか？' : 'data.jsonがありません。空のデータを作成しますか？現在の画面のデータは引き継ぎません。')) return
        loaded = await candidate.save(copy ? current.current : emptyState)
      }
      store.current = candidate
      setFolder(directory.name)
      replace(toState(loaded))
      generation.current++
      dirty.current = false
      failure.current = null
      freeze(false)
      setBackups([])
      setStatus('保存済み')
      setMessage('data.jsonを読み込みました。変更は編集確定時に自動保存します。')
    } catch (error) {
      if (cancelled(error, picking)) return
      if (candidate && error instanceof StorageError && ['invalid', 'version'].includes(error.code) && !copy) {
        store.current = candidate
        setFolder(candidate.directory.name)
        setBackups([])
      }
      failed(error)
      setMessage(`${storageMessage(error)} 画面には読み込み前のデータを保持しています。`)
    } finally { end() }
  }
  async function listBackups() {
    if (!store.current || operation.current || pending.current) return
    begin()
    try { const result = await store.current.listBackups(); setBackups(result.names); setTruncated(result.truncated) }
    catch (error) { setMessage(storageMessage(error)) }
    finally { end() }
  }
  async function restore(name: string) {
    if (!store.current || operation.current || pending.current) return
    if (!window.confirm('このバックアップを復元しますか？現在の正本は退避します。画面の未保存の変更は、復元成功時に置き換わります。')) return
    begin()
    setStatus('保存中')
    try {
      const doc = await store.current.restore(name)
      replace(toState(doc))
      dirty.current = false
      generation.current++
      failure.current = null
      freeze(false)
      setStatus('保存済み')
      setMessage('バックアップを復元し、data.jsonへの書き込みを確認しました。')
    } catch (error) { failed(error) }
    finally { end() }
  }
  return { state, commit, status, message, folder, backups, truncated, supported, busy, readOnly, pendingCount, selectFolder, retry, listBackups, restore }
}
