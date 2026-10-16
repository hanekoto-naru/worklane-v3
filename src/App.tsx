import { useEffect, useState } from 'react'
import { IconLayoutDashboard, IconCheckbox, IconUsers, IconMessageCircle, IconFolder, IconSearch, IconArrowUpRight, IconChevronRight, IconShieldLock, IconLayoutSidebarLeftCollapse, IconArrowRight, IconCalendar, IconCircleCheck, IconFlag, IconPlus, IconSettings } from '@tabler/icons-react'
import { projectCounts, sortTasks, mineStatuses, delegatedStatuses, shortDate } from './data'
import Editor from './Editor'
import { pageFromHash, pageHash } from './navigation'
import type { Page } from './navigation'
import { openFromRow } from './selection'
import Settings from './Settings'
import Paged from './Paged'
import { Choice, Toggle } from './Choice'
import StorageBar from './StorageBar'
import { useFileWorkspace } from './useFileWorkspace'
import type { EditorValue } from './Editor'
import type { Task, Note, WorkAction } from './data'
import s from './App.module.css'

const navigation = [
  { id: 'dashboard', label: 'ダッシュボード', icon: IconLayoutDashboard },
  { id: 'mine', label: '自分のタスク', icon: IconCheckbox },
  { id: 'delegated', label: '依頼したタスク', icon: IconUsers },
  { id: 'notes', label: '確認事項', icon: IconMessageCircle },
  { id: 'settings', label: '設定', icon: IconSettings },
  { id: 'projects', label: '目標・施策', icon: IconFolder },
] as const

function App() {
  const [page, setPage] = useState<Page>(() => pageFromHash(typeof window === 'undefined' ? '' : window.location.hash))
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [project, setProject] = useState('all')
  const workspace = useFileWorkspace()
  const { state } = workspace
  const today = new Date().toLocaleDateString('sv-SE')
  const [editor, setEditor] = useState<EditorValue | null>(null)
  const [editorReturnFocus, setEditorReturnFocus] = useState<HTMLElement | null>(null)
  const openEditor = (value: EditorValue) => {
    setEditorReturnFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setEditor(value)
  }
  const [owner, setOwner] = useState('all')
  const [sort, setSort] = useState('due')
  const [notice, setNotice] = useState('')
  const { tasks, notes, projects, people } = state
  const projectNames = new Map(projects.map(p => [p.id, p.name]))
  const personNames = new Map(people.map(p => [p.id, p.name]))
  const projectName = (id: string) => projectNames.get(id) ?? '未分類'
  const personName = (id: string) => personNames.get(id) ?? id
  const listKey = [page, query, filter, project, owner, sort].join('|')
  const commit = (action: WorkAction) => {
    workspace.commit(action)
    setNotice(action.type === 'delete' ? '削除を反映しました。保存状態を確認してください。' : '変更を反映しました。保存状態を確認してください。')
  }
  const newRecord = (kind: 'mine' | 'delegated' | 'notes' | 'projects') => {
    const id = crypto.randomUUID()
    const projectId = project !== 'all' && projects.some(p => p.id === project && !p.archived) ? project : ''
    if (kind === 'projects') openEditor({ kind: 'project', value: { id, name: '', description: '', due: '', archived: false } })
    else if (kind === 'notes') openEditor({ kind: 'note', value: { id, title: '', detail: '', person: '', project: projectId, checked: false } })
    else openEditor({ kind: 'task', value: { id, title: '', detail: '', project: projectId, priority: 'なし', due: '', url: '', ...(kind === 'mine' ? { kind, status: '未着手', owner: '自分' } : { kind, status: '依頼済み', owner: '', nextCheck: '' }) } })
  }
  const [collapsed, setCollapsed] = useState(false)
  const openTasks = tasks.filter(t => t.status !== '完了')
  const urgent = openTasks.filter(t => (t.due && t.due <= today) || (t.kind === 'delegated' && t.nextCheck && t.nextCheck <= today))
  const current = navigation.find(n => n.id === page)!
  const match = (text: string) => text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  const navigate = (next: Page, projectId = 'all') => { if (window.location.hash !== pageHash(next)) window.history.pushState(null, '', pageHash(next)); setPage(next); setQuery(''); setFilter('all'); setProject(projectId); setEditor(null); setOwner('all'); setSort('due'); setNotice('') }
  useEffect(() => {
    const onHashChange = () => { setPage(pageFromHash(window.location.hash)); setQuery(''); setFilter('all'); setProject('all'); setOwner('all'); setSort('due'); setNotice('') }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  useEffect(() => { document.title = `${current.label} | Worklane` }, [current.label])
  const visibleTasks = sortTasks(tasks.filter(t => (t.kind === page || page === 'projects') && (owner === 'all' || t.owner === owner) && (project === 'all' || t.project === project) && (filter === 'all' || t.status === filter) && match(`${t.title} ${t.detail} ${personName(t.owner)} ${projectName(t.project)}`)), sort)
  const visibleNotes = notes.filter(n => (project === 'all' || n.project === project) && (filter === 'all' || (filter === 'checked' ? n.checked : !n.checked)) && match(`${n.title} ${n.detail} ${personName(n.person)} ${projectName(n.project)}`)).sort((a, b) => sort === 'status' ? Number(a.checked) - Number(b.checked) : a.title.localeCompare(b.title, 'ja'))
  const visibleProjects = projects.filter(p => (filter === 'archived' ? p.archived : filter === 'all' ? !p.archived : true) && match(`${p.name} ${p.description}`)).sort((a, b) => sort === 'title' ? a.name.localeCompare(b.name, 'ja') : (a.due || '9999').localeCompare(b.due || '9999'))

  function taskTable(rows: Task[], delegated = false) {
    return <Paged key={listKey} items={rows}>{pageRows => <div className={s.tableScroll}><table><thead><tr><th scope="col">タスク</th><th scope="col">ステータス</th><th scope="col">優先度</th>{delegated && <th scope="col">担当者</th>}<th scope="col">目標・施策</th><th scope="col">期限</th>{delegated && <th scope="col">次回確認</th>}</tr></thead><tbody>{pageRows.map(t => <tr key={t.id} className={s.interactiveRow} onClick={event => openFromRow(event, () => openEditor({ kind: 'task', value: t }), workspace.busy)}>
      <td><button className={s.taskTitle} data-row-action="true" disabled={workspace.busy} onClick={() => openEditor({ kind: 'task', value: t })}><span>{t.title}</span></button></td>
      <td><span className={s.badge} data-status={t.status}><span className={s.dot} />{t.status}</span></td>
      <td><span className={t.priority === '高' ? s.high : s.muted}><IconFlag size={13} /> {t.priority}</span></td>
      {delegated && <td>{personName(t.owner)}</td>}<td><span className={s.projectTag}>{projectName(t.project)}</span></td><td className={t.due && t.due <= today && t.status !== '完了' ? s.due : ''}>{shortDate(t.due)}{t.due === today && <small> 今日</small>}</td>{delegated && <td>{t.kind === 'delegated' && t.nextCheck ? shortDate(t.nextCheck) : '—'}</td>}
    </tr>)}</tbody></table>{rows.length === 0 && <div className={s.empty}>該当するタスクはありません。検索や絞り込みを変更してください。</div>}</div>}</Paged>
  }

  function noteList(rows: Note[]) {
    return <Paged key={listKey} items={rows}>{pageRows => <div>{pageRows.map(n => <div className={`${s.noteRow} ${s.interactiveRow}`} onClick={event => openFromRow(event, () => openEditor({ kind: 'note', value: n }), workspace.busy)} key={n.id} role="group" aria-label={n.title}>
      <Toggle label="確認済み" disabled={workspace.readOnly || workspace.busy} checked={n.checked} onChange={checked => {
        try { commit({ type: 'put', kind: 'note', value: { ...n, checked } }) } catch { setNotice('変更を反映できませんでした') }
      }} />
      <div className={n.checked ? s.checkedNote : ''}><button className={s.taskTitle} data-row-action="true" disabled={workspace.busy} onClick={() => openEditor({ kind: 'note', value: n })}>{n.title}</button><p>{n.detail}</p><small>{personName(n.person)} · {projectName(n.project)}</small></div><span className={s.badge}>{n.checked ? <><IconCircleCheck size={14} />確認済み</> : '未確認'}</span>
    </div>)}{rows.length === 0 && <div className={s.empty}>該当する確認事項はありません。</div>}</div>}</Paged>
  }

  return <div className={`${s.app} ${collapsed ? s.collapsed : ''}`}>
    <a className={s.skip} href="#main">本文へ移動</a>
    <aside className={s.sidebar}>
      <div className={s.brand}><IconCheckbox className={s.brandIcon} size={28} stroke={1.8} /><span className={s.sidebarText}>Worklane</span></div>
      <div className={`${s.navLabel} ${s.sidebarText}`}>業務</div>
      <nav aria-label="メインナビゲーション">{navigation.filter(n => n.id !== 'settings').map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? s.activeNav : s.navItem} onClick={() => navigate(id)} aria-current={page === id ? 'page' : undefined} title={label}><Icon size={19} stroke={1.65} /><span className={s.sidebarText}>{label}</span>{(id === 'mine' || id === 'delegated') && <span className={`${s.navCount} ${s.sidebarText}`}>{openTasks.filter(t => t.kind === id).length}</span>}</button>)}</nav>
      <div className={`${s.sidebarProjects} ${s.sidebarText}`}><div className={s.navLabel}>目標・施策</div>{projects.filter(p => !p.archived).slice(0, 8).map((p, i) => <button key={p.id} aria-current={page === 'projects' && project === p.id ? 'page' : undefined} onClick={() => navigate('projects', p.id)}><span className={s.projectDot} data-color={i} /><span className={s.sidebarProjectName}>{p.name}</span></button>)}</div>
      <div className={s.sidebarBottom}><nav aria-label="設定"><button className={page === 'settings' ? s.activeNav : s.navItem} onClick={() => navigate('settings')} aria-current={page === 'settings' ? 'page' : undefined} title="設定" aria-label="設定"><IconSettings size={19} stroke={1.65} /><span className={s.sidebarText}>設定</span></button></nav><div className={`${s.localNotice} ${s.sidebarText}`}><IconShieldLock size={17} /><div>ローカルJSON保存<small>{workspace.folder ? 'data.json' : '保存先未選択'}</small></div></div><button className={s.collapseButton} onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'サイドバーを展開' : 'サイドバーを折りたたむ'} aria-expanded={!collapsed}><IconLayoutSidebarLeftCollapse size={19} /><span className={s.sidebarText}>サイドバーを折りたたむ</span></button></div>
    </aside>
    <div className={s.mainArea}><header className={s.header}><div><span className={s.muted}>ワークスペース</span><IconChevronRight size={14} /><span>{current.label}</span></div><span className={s.storageLabel}><span className={s.dot} /> {workspace.folder ? 'ローカル保存' : '保存先未選択'}</span></header>
      <main id="main" className={s.main} tabIndex={-1}>
        <div className={s.pageHeading}><div><h1><current.icon size={28} stroke={2} />{current.label}</h1><p>{page === 'dashboard' ? '未完了件数と期限・確認日を表示します。' : page === 'mine' ? 'タスクの登録・編集・進捗管理。' : page === 'delegated' ? '依頼した作業の進捗と次回確認日を管理。' : page === 'notes' ? '確認事項と確認結果を管理。' : page === 'settings' ? '目標・施策と関係者の登録・変更。' : '目標・施策ごとのタスク・依頼・確認事項と進捗を管理。'}</p></div><div className={s.currentDate}><IconCalendar size={17} />{shortDate(today, true)}<small>今日</small></div></div>
        <StorageBar workspace={workspace} />
        <p role="status" className={s.sectionDescription}>{notice}</p>
        {page === 'settings' ? <Settings state={state} openEditor={openEditor} disabled={workspace.readOnly || workspace.busy} /> : page === 'dashboard' ? <>
          <div className={s.metrics}>{[
            { label: '自分の未完了タスク', value: openTasks.filter(t => t.kind === 'mine').length, target: 'mine' as Page, icon: IconCheckbox, note: '未着手・進行中・保留' },
            { label: '未完了の依頼', value: openTasks.filter(t => t.kind === 'delegated').length, target: 'delegated' as Page, icon: IconUsers, note: `${tasks.filter(t => t.status === 'レビュー待ち').length}件がレビュー待ち` },
            { label: '未確認のメモ', value: notes.filter(n => !n.checked).length, target: 'notes' as Page, icon: IconMessageCircle, note: '確認が必要な項目' },
          ].map(({ label, value, target, icon: Icon, note }) => <button key={target} className={s.metric} onClick={() => navigate(target)}><div><Icon size={18} /><span>{label}</span><IconArrowUpRight size={16} /></div><strong>{value}<small>件</small></strong><p>{note}</p></button>)}</div>
          <section className={s.section}><div className={s.sectionHeading}><h2><span className={s.attentionDot} />期限・確認日が到来したタスク <span>{urgent.length}</span></h2><button onClick={() => navigate('mine')}>タスク一覧へ<IconArrowRight size={15} /></button></div><p className={s.sectionDescription}>今日までが期限、または次回確認日のタスク</p>{taskTable(urgent)}</section>
          <div className={s.dashboardBottom}><section className={s.section}><div className={s.sectionHeading}><h2>目標・施策</h2><button onClick={() => navigate('projects')} aria-label="目標・施策一覧へ"><IconArrowUpRight size={18} /></button></div>{projects.filter(p => !p.archived).slice(0, 8).map(p => { const { total, done } = projectCounts(state, p.id); return <button className={s.projectSummary} key={p.id} onClick={() => navigate('projects', p.id)}><IconFolder size={19} /><div><strong>{p.name}</strong><small>{done} / {total} 件完了</small></div><progress value={done} max={total || 1} aria-label={`${p.name}の完了数`} /><span>{Math.round(done / (total || 1) * 100)}%</span></button> })}</section>
          <section className={s.section}><div className={s.sectionHeading}><h2>次に確認すること</h2><button onClick={() => navigate('notes')} aria-label="確認メモ一覧へ"><IconArrowUpRight size={18} /></button></div>{notes.filter(n => !n.checked).slice(0, 5).map(n => <button className={s.briefNote} key={n.id} disabled={workspace.busy} onClick={() => openEditor({ kind: 'note', value: n })}><IconMessageCircle size={18} /><div><strong>{n.title}</strong><small>{personName(n.person)} · {projectName(n.project)}</small></div></button>)}{notes.every(n => n.checked) && <p className={s.empty}>{notes.length ? 'すべての確認が完了しました。' : '確認事項はありません。'}</p>}</section></div>
        </> : <>
          <div className={s.toolbar}>
            <label className={s.search}><IconSearch size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="キーワードで検索…" aria-label="一覧を検索" /></label>
            <button className={s.primaryButton} disabled={workspace.readOnly || workspace.busy} onClick={() => newRecord(page)}><IconPlus size={16} />新規登録</button>
          </div>
          <div className={s.filters}>
            <Choice label="目標・施策で絞り込み" value={project} onChange={value => { setProject(value); setFilter('all') }} options={[{ value: 'all', label: 'すべての目標・施策' }, ...projects.map(p => ({ value: p.id, label: p.name + (p.archived ? '（アーカイブ済み）' : '') }))]} />
            {!(page === 'projects' && project !== 'all') && <Choice label="状態で絞り込み" value={filter} onChange={setFilter} options={[{ value: 'all', label: page === 'projects' ? '進行中の目標・施策' : 'すべての状態' }, ...(page === 'projects' ? [['archived', 'アーカイブ済み'], ['both', 'すべて']] : page === 'notes' ? [['unchecked', '未確認'], ['checked', '確認済み']] : (page === 'mine' ? mineStatuses : delegatedStatuses).map(v => [v, v])).map(([value, label]) => ({ value, label }))]} />}
            {page === 'delegated' && <Choice label="担当者で絞り込み" value={owner} onChange={setOwner} options={[{ value: 'all', label: 'すべての担当者' }, ...people.map(p => ({ value: p.id, label: p.name }))]} />}
            <Choice label="並び替え" value={sort} onChange={setSort} options={[{ value: 'due', label: page === 'notes' ? 'タイトル順' : '期限が近い順' }, ...(page === 'notes' ? [{ value: 'status', label: '未確認順' }] : [{ value: 'title', label: 'タイトル順' }]), ...(page !== 'notes' && page !== 'projects' ? [{ value: 'priority', label: '優先度が高い順' }] : [])]} />


          </div>
          {(page === 'mine' || page === 'delegated') && taskTable(visibleTasks, page === 'delegated')}
          {page === 'notes' && noteList(visibleNotes)}
          {page === 'projects' && project !== 'all' && <section className={s.section}>
            <div className={s.sectionHeading}><h2>{projectName(project)}{projects.find(p => p.id === project)?.archived ? '（アーカイブ済み）' : ''}</h2><button disabled={workspace.busy} onClick={() => { const p = projects.find(p => p.id === project); if (p) openEditor({ kind: 'project', value: p }) }}>目標・施策を編集</button></div>
            <p className={s.sectionDescription}>未完了 {projectCounts(state, project).open}件 / 完了 {projectCounts(state, project).done}件</p>
            <div className={s.toolbar}>{(['mine', 'delegated', 'notes'] as const).map(kind => <button key={kind} className={s.textButton} disabled={workspace.readOnly || workspace.busy} onClick={() => newRecord(kind)}><IconPlus size={15} />{kind === 'mine' ? '自分のタスク' : kind === 'delegated' ? '依頼したタスク' : '確認事項'}</button>)}</div>
            <h2 className={s.subheading}>自分のタスク</h2>{taskTable(visibleTasks.filter(t => t.kind === 'mine'))}
            <h2 className={s.subheading}>依頼したタスク</h2>{taskTable(visibleTasks.filter(t => t.kind === 'delegated'), true)}
            <h2 className={s.subheading}>確認事項</h2>{noteList(visibleNotes)}
          </section>}
          {page === 'projects' && project === 'all' && <Paged key={listKey} items={visibleProjects}>{pageProjects => <div className={s.tableScroll}><table><thead><tr><th scope="col">目標・施策</th><th scope="col">未完了</th><th scope="col">完了</th><th scope="col">期限</th><th scope="col">操作</th></tr></thead><tbody>{pageProjects.map(p => {
            const counts = projectCounts(state, p.id)
            return <tr key={p.id} className={s.interactiveRow} onClick={event => openFromRow(event, () => navigate('projects', p.id))}><td><button className={s.taskTitle} onClick={() => navigate('projects', p.id)}>{p.name}{p.archived ? '（アーカイブ済み）' : ''}</button><p className={s.projectDescription}>{p.description}</p></td><td>{counts.open}件</td><td>{counts.done}件</td><td>{shortDate(p.due)}</td><td><button className={s.textButton} disabled={workspace.busy} onClick={() => openEditor({ kind: 'project', value: p })}>編集</button><button className={s.textButton} onClick={() => navigate('projects', p.id)}>業務一覧<IconArrowUpRight size={14} /></button></td></tr>
          })}</tbody></table>{visibleProjects.length === 0 && <div className={s.empty}>該当する目標・施策はありません。</div>}</div>}</Paged>}

        </>}
        <footer className={s.footer}><span>WORKLANE <span>/</span> 業務管理</span><span>{workspace.folder ? 'ローカルファイル · 自動保存' : '保存先未選択 · 変更は再読み込みで消えます'}</span></footer>
      </main>
      {editor && <Editor key={editor.value.id} editor={editor} returnFocus={editorReturnFocus} state={state} commit={commit} fileMode={!!workspace.folder} readOnly={workspace.readOnly || workspace.busy} close={() => setEditor(null)} />}
    </div>
  </div>
}
export default App
