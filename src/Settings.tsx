import { useState } from 'react'
import { IconPlus, IconSearch } from '@tabler/icons-react'
import { availablePersonLabels, projectPath } from './data'
import type { WorkState, WorkAction } from './data'
import type { EditorValue } from './Editor'
import Paged from './Paged'
import { openFromRow } from './selection'
import { Choice } from './Choice'
import s from './App.module.css'

export default function Settings({ state, openEditor, disabled, commit }: { state: WorkState; commit?: (action: WorkAction) => void; openEditor: (value: EditorValue) => void; disabled: boolean }) {
  const [category, setCategory] = useState('people')
  const [query, setQuery] = useState('')
  const [label, setLabel] = useState('all')
  const personLabels = availablePersonLabels(state.people)
  const people = state.people.filter(p => (label === 'all' || p.labels?.some(value => value === label)) && p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  function moveButtons(kind: 'person' | 'project', id: string, name: string) {
    const items = kind === 'person' ? state.people : state.projects
    const index = items.findIndex(item => item.id === id)
    return <><button aria-label={name + 'を上へ'} disabled={disabled || !commit || index === 0} onClick={() => commit?.({ type: 'move', kind, id, direction: -1 })}>↑</button><button aria-label={name + 'を下へ'} disabled={disabled || !commit || index === items.length - 1} onClick={() => commit?.({ type: 'move', kind, id, direction: 1 })}>↓</button></>
  }
  return <div className={s.settings}>
    <Choice label="設定項目" value={category} onChange={value => { setCategory(value); setQuery('') }} options={[{ value: 'people', label: '関係者' }, { value: 'projects', label: 'ラベル' }]} />
    {category === 'projects' ? <>
    <section className={s.section}>
      <div className={s.sectionHeading}><h2>ラベル</h2><button className={s.primaryButton} disabled={disabled} onClick={() => openEditor({ kind: 'project', value: { id: crypto.randomUUID(), name: '', description: '', due: '', archived: false } })}><IconPlus size={16} />ラベルを追加</button></div>
      <p className={s.sectionDescription}>ラベルごとにタスク・依頼をまとめ、期限と進捗を管理します。</p>
      <Paged items={state.projects}>{rows => <div className={s.tableScroll}><table className={s.settingsTable}><colgroup><col /><col className={s.colStatus} /><col className={s.colActions} /></colgroup><thead><tr><th scope="col">名前</th><th scope="col">状態</th><th scope="col">操作</th></tr></thead><tbody>{rows.map(p => <tr key={p.id} className={s.interactiveRow} onClick={event => openFromRow(event, () => openEditor({ kind: 'project', value: p }), disabled)}><td className={s.settingsName}><span className={s.projectTag} data-label-color={p.color ?? 'gray'}>{projectPath(state.projects, p.id)}</span></td><td>{p.archived ? 'アーカイブ済み' : '進行中'}</td><td><button className={s.textButton} disabled={disabled} onClick={() => openEditor({ kind: 'project', value: p })} aria-label={p.name + 'を編集'}>編集</button>{moveButtons('project', p.id, p.name)}</td></tr>)}</tbody></table>{rows.length === 0 && <p className={s.empty}>ラベルはありません。</p>}</div>}</Paged>
    </section>
    </> : <><section className={s.section}>
      <div className={s.sectionHeading}><h2>関係者</h2><button className={s.primaryButton} disabled={disabled} onClick={() => openEditor({ kind: 'person', value: { id: crypto.randomUUID(), name: '' } })}><IconPlus size={16} />関係者を追加</button></div>
      <p className={s.sectionDescription}>名前と任意の関係者ラベルを設定します。名前を変更しても業務との紐付けは維持されます。</p>
      <div className={s.toolbar}><label className={s.search}><IconSearch size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="名前で検索…" aria-label="関係者を検索" /></label></div>
      <Choice label="ラベルで絞り込み" value={label} onChange={setLabel} options={[{ value: 'all', label: 'すべて' }, ...personLabels.map(value => ({ value, label: value }))]} />
      <Paged key={query + label} items={people}>{rows => <div className={s.tableScroll}><table className={s.settingsTable}><colgroup><col /><col className={s.colPersonLabels} /><col className={s.colCount} /><col className={s.colActions} /></colgroup><thead><tr><th scope="col">名前</th><th scope="col">ラベル</th><th scope="col">関連タスク</th><th scope="col">操作</th></tr></thead><tbody>{rows.map(p => <tr key={p.id} className={s.interactiveRow} onClick={event => openFromRow(event, () => openEditor({ kind: 'person', value: p }), disabled)}><td className={s.settingsName}>{p.name}</td><td><div className={s.personLabels}>{personLabels.some(label => p.labels?.includes(label)) ? personLabels.filter(label => p.labels?.includes(label)).map(label => <span key={label}>{label}</span>) : '—'}</div></td><td>{state.tasks.filter(t => t.owner === p.id || t.relatedPeople?.includes(p.id)).length}件</td><td><button className={s.textButton} disabled={disabled} onClick={() => openEditor({ kind: 'person', value: p })} aria-label={p.name + 'を編集'}>編集</button>{moveButtons('person', p.id, p.name)}</td></tr>)}</tbody></table>{rows.length === 0 && <p className={s.empty}>該当する関係者はありません。</p>}</div>}</Paged>
    </section>
    </>}
  </div>
}
