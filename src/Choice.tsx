import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconCheck, IconCircle, IconFlag, IconSearch, IconX } from '@tabler/icons-react'
import { nextChoiceIndex, searchChoices } from './selection'
import type { ChoiceOption } from './selection'
import s from './App.module.css'

type Props = {
  label: string; options: ChoiceOption[]; name?: string; value?: string; defaultValue?: string
  onChange?: (value: string) => void; disabled?: boolean; icon?: 'status' | 'priority'
}
function ChoiceButtons({ items, label, selected, disabled, icon, onSelect, arrowsSelect = false }: {
  items: ChoiceOption[]; label: string; selected: string; disabled?: boolean; icon?: Props['icon']; onSelect: (value: string) => void; arrowsSelect?: boolean
}) {
  return <div className={s.choiceButtons} role="group" aria-label={label}>
    {items.map((option, index) => <button type="button" key={option.value} disabled={disabled} aria-pressed={selected === option.value}
      onClick={() => onSelect(option.value)} onKeyDown={event => {
        const next = nextChoiceIndex(index, items.length, event.key)
        if (next === null) return
        event.preventDefault()
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
        if (arrowsSelect) onSelect(items[next].value)
      }}>
      {icon === 'priority' ? <IconFlag size={14} aria-hidden="true" /> : icon === 'status' ? <IconCircle size={14} aria-hidden="true" /> : null}
      <span>{option.label}</span>{selected === option.value && <IconCheck size={14} aria-hidden="true" />}
    </button>)}
  </div>
}

export function Choice({ label, options, name, value, defaultValue = '', onChange, disabled, icon }: Props) {
  const [local, setLocal] = useState(defaultValue)
  const [opened, setOpened] = useState(false)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(100)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const heading = useId()
  const selected = value ?? local
  const many = options.length > 7
  const matches = searchChoices(options, query)
  function select(next: string) { setLocal(next); onChange?.(next) }
  function close() { dialog.current?.close(); setOpened(false); trigger.current?.focus() }

  return <div className={s.choice}>
    <span className={s.choiceLabel}>{label}</span>
    {name && <input type="hidden" name={name} value={selected} />}
    {many ? <button type="button" ref={trigger} className={s.choiceTrigger} disabled={disabled} aria-haspopup="dialog" aria-expanded={opened} onClick={() => { setQuery(''); setLimit(100); setOpened(true) }}>
      <IconSearch size={15} aria-hidden="true" /><span>{options.find(option => option.value === selected)?.label ?? '未選択'}</span><span>候補を検索</span>
    </button> : <ChoiceButtons items={options} label={label} selected={selected} disabled={disabled} icon={icon} onSelect={select} arrowsSelect /> }
    {opened && createPortal(<dialog ref={element => { dialog.current = element; if (element && !element.open) element.showModal() }} className={s.choiceDialog} aria-labelledby={heading} onCancel={event => { event.preventDefault(); event.stopPropagation(); close() }}>
      <div className={s.sectionHeading}><h2 id={heading}>{label}</h2><button type="button" onClick={close} aria-label="候補選択を閉じる"><IconX size={19} /></button></div>
      <label className={s.search}><IconSearch size={16} /><input autoFocus value={query} aria-label="候補を検索" onChange={event => { event.stopPropagation(); setQuery(event.target.value); setLimit(100) }} /></label>
      <p role="status">{matches.length}件{matches.length > limit ? `（${limit}件表示）` : ''}</p>
      <ChoiceButtons items={matches.slice(0, limit)} label={label} selected={selected} disabled={disabled} icon={icon} onSelect={next => { select(next); close() }} />
      {!matches.length && <p>該当する候補はありません。</p>}
      {matches.length > limit && <button type="button" className={s.textButton} onClick={() => setLimit(limit + 100)}>次の100件を表示</button>}
    </dialog>, document.body)}
  </div>
}

export function Toggle({ label, name, checked, defaultChecked = false, onChange, disabled }: {
  label: string; name?: string; checked?: boolean; defaultChecked?: boolean; onChange?: (value: boolean) => void; disabled?: boolean
}) {
  const [local, setLocal] = useState(defaultChecked)
  const active = checked ?? local
  function update(next: boolean) { setLocal(next); onChange?.(next) }
  return <span className={s.toggleWrap}>
    {name && active && <input type="hidden" name={name} value="on" />}
    <button type="button" role="switch" aria-checked={active} aria-label={label} disabled={disabled} className={s.toggle}
      onClick={() => update(!active)} onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault(); update(event.key === 'ArrowRight' || event.key === 'ArrowUp')
        }
      }}><span aria-hidden="true">{active ? <IconCheck size={14} /> : '−'}</span>{label}<strong>{active ? 'ON' : 'OFF'}</strong></button>
  </span>
}
