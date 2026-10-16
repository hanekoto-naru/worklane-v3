import { useEffect, useState } from 'react'
import { IconFolder, IconHistory, IconRefresh } from '@tabler/icons-react'
import type { useFileWorkspace } from './useFileWorkspace'
import s from './App.module.css'

function SavedNotice() {
  const [visible, setVisible] = useState(true)
  useEffect(() => { const timer = window.setTimeout(() => setVisible(false), 3000); return () => window.clearTimeout(timer) }, [])
  return visible ? <strong role="status">保存済み</strong> : null
}

export default function StorageBar({ workspace }: { workspace: ReturnType<typeof useFileWorkspace> }) {
  const [showBackups, setShowBackups] = useState(false)
  const w = workspace
  const disabled = w.busy || w.pendingCount > 0
  return <section className={s.storage} aria-label="ローカルファイル保存">
    <div className={s.storageActions}>
      {w.status === '保存済み' && !w.readOnly ? <SavedNotice key={w.folder + w.message} /> : <strong role="status">{w.status}{w.readOnly ? ' · 読み取り専用' : ''}</strong>}
      <span>{w.folder ? `保存先：${w.folder}` : '保存先未選択'}</span>
      <button disabled={!w.supported || disabled} onClick={() => void w.selectFolder()}><IconFolder size={15} />{w.folder ? '保存先を再選択' : '保存先フォルダを選択'}</button>
      <button disabled={!w.supported || disabled} onClick={() => void w.selectFolder(true)}>画面のデータを別フォルダへ保存</button>
      {w.status === '保存失敗' && <button disabled={disabled || !w.folder || w.readOnly} onClick={w.retry}><IconRefresh size={15} />再試行</button>}
      <button disabled={!w.folder || disabled} onClick={() => { setShowBackups(!showBackups); if (!showBackups) void w.listBackups() }}><IconHistory size={15} />バックアップ</button>
    </div>
    {(w.status !== '保存済み' || !w.supported || w.messageIsError) && <p role={w.status === '保存失敗' || w.messageIsError ? 'alert' : undefined}>{w.supported ? w.message : 'この環境では保存機能を利用できません。ChromeのセキュアコンテキストとWeb Locks APIが必要です。'}</p>}
    {!w.folder && <small>プロジェクト内の data フォルダを作成して選択してください。Git除外対象の永続保存先です。再起動後は同じフォルダを再選択します。</small>}
    {showBackups && <div className={s.backupList}><div className={s.sectionHeading}><h2>バックアップ一覧</h2><button disabled={disabled} onClick={() => void w.listBackups()}>一覧を更新</button></div><p>復元時に内容を検証します。バックアップは自動削除しません。空き容量を定期的に確認してください。</p>{w.truncated && <p>一覧は先頭2,000項目の走査で取得できた分です。未表示のファイルがあります。</p>}{w.backups.length === 0 && <p>表示できるバックアップはありません。</p>}{w.backups.map(name => <div key={name} className={s.backupRow}><span>{name}</span><button disabled={disabled} onClick={() => void w.restore(name)}>復元</button></div>)}</div>}
  </section>
}
