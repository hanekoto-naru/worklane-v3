import { useState } from 'react'
import { IconPlus, IconSearch } from '@tabler/icons-react'
import { personLabels } from './data'
import type { WorkState } from './data'
import type { EditorValue } from './Editor'
import Paged from './Paged'
import { openFromRow } from './selection'
import { Choice } from './Choice'
import s from './App.module.css'

export default function Settings({ state, openEditor, disabled }: { state: WorkState; openEditor: (value: EditorValue) => void; disabled: boolean }) {
  const [category, setCategory] = useState('people')
  const [query, setQuery] = useState('')
  const [label, setLabel] = useState('all')
  const people = state.people.filter(p => (label === 'all' || p.labels?.some(value => value === label)) && p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <div className={s.settings}>
    <Choice label="設定項目" value={category} onChange={value => { setCategory(value); setQuery('') }} options={[{ value: 'people', label: '関係者' }, { value: 'projects', label: '目標・施策' }]} />
    {category === 'projects' ? <>
    <section className={s.section}>
      <div className={s.sectionHeading}><h2>目標・施策</h2><button className={s.primaryButton} disabled={disabled} onClick={() => openEditor({ kind: 'project', value: { id: crypto.randomUUID(), name: '', description: '', due: '', archived: false } })}><IconPlus size={16} />目標・施策を追加</button></div>
      <p className={s.sectionDescription}>目標・施策ごとにタスク・依頼・確認事項をまとめ、期限と進捗を管理します。</p>
      <Paged items={state.projects}>{rows => <div className={s.tableScroll}><table><thead><tr><th scope="col">名前</th><th scope="col">状態</th><th scope="col">操作</th></tr></thead><tbody>{rows.map(p => <tr key={p.id} className={s.interactiveRow} onClick={event => openFromRow(event, () => openEditor({ kind: 'project', value: p }), disabled)}><td className={s.settingsName}>{p.name}</td><td>{p.archived ? 'アーカイブ済み' : '進行中'}</td><td><button className={s.textButton} disabled={disabled} onClick={() => openEditor({ kind: 'project', value: p })} aria-label={p.name + 'を編集'}>編集</button></td></tr>)}</tbody></table>{rows.length === 0 && <p className={s.empty}>目標・施策はありません。</p>}</div>}</Paged>
    </section>
    </> : <><section className={s.section}>
      <div className={s.sectionHeading}><h2>関係者</h2><button className={s.primaryButton} disabled={disabled} onClick={() => openEditor({ kind: 'person', value: { id: crypto.randomUUID(), name: '' } })}><IconPlus size={16} />関係者を追加</button></div>
      <p className={s.sectionDescription}>名前とチーム外・営業のラベルを設定します。名前を変更しても業務との紐付けは維持されます。</p>
      <div className={s.toolbar}><label className={s.search}><IconSearch size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="名前で検索…" aria-label="関係者を検索" /></label></div>
      <Choice label="ラベルで絞り込み" value={label} onChange={setLabel} options={[{ value: 'all', label: 'すべて' }, ...personLabels.map(value => ({ value, label: value }))]} />
      <Paged key={query + label} items={people}>{rows => <div className={s.tableScroll}><table><thead><tr><th scope="col">名前</th><th scope="col">ラベル</th><th scope="col">依頼</th><th scope="col">確認事項</th><th scope="col">操作</th></tr></thead><tbody>{rows.map(p => <tr key={p.id} className={s.interactiveRow} onClick={event => openFromRow(event, () => openEditor({ kind: 'person', value: p }), disabled)}><td className={s.settingsName}>{p.name}</td><td><div className={s.personLabels}>{personLabels.some(label => p.labels?.includes(label)) ? personLabels.filter(label => p.labels?.includes(label)).map(label => <span key={label}>{label}</span>) : '—'}</div></td><td>{state.tasks.filter(t => t.kind === 'delegated' && t.owner === p.id).length}件</td><td>{state.notes.filter(n => n.person === p.id).length}件</td><td><button className={s.textButton} disabled={disabled} onClick={() => openEditor({ kind: 'person', value: p })} aria-label={p.name + 'を編集'}>編集</button></td></tr>)}</tbody></table>{rows.length === 0 && <p className={s.empty}>該当する関係者はありません。</p>}</div>}</Paged>
    </section>
    </>}
  </div>
}
