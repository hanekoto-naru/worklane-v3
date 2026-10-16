import { useId, useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { IconCalendar, IconChevronLeft, IconChevronRight, IconX } from '@tabler/icons-react'
import { shortDate } from './data'
import s from './App.module.css'

function iso(date: Date) { return `${date.getFullYear().toString().padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
const parse = (value: string) => new Date(value + 'T12:00:00')
export default function DateField({ label, name, value, onChange, disabled }: {
  label: string; name: string; value: string; onChange: (value: string) => void; disabled?: boolean
}) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [opened, setOpened] = useState(false)
  const [original] = useState(value)
  const today = iso(new Date())
  const [active, setActive] = useState(value || iso(new Date()))
  const [month, setMonth] = useState(active.slice(0, 7))
  const first = parse(month + '-01')
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const offset = (first.getDay() + 6) % 7
  function open() {
    const next = value && value >= today ? value : today
    setActive(next); setMonth(next.slice(0, 7)); setOpened(true)
  }
  function close() { dialog.current?.close(); setOpened(false); input.current?.focus() }
  function moveMonth(amount: number) {
    const next = new Date(first.getFullYear(), first.getMonth() + amount, 1, 12)
    if (next.getFullYear() < 1 || next.getFullYear() > 9999) return
    const day = iso(next) < today ? today : iso(next)
    setMonth(day.slice(0, 7)); setActive(day)
  }
  useEffect(() => {
    if (opened) dialog.current?.querySelector<HTMLButtonElement>(`button[data-date="${active}"]`)?.focus()
  }, [opened, active])
  return <div className={s.dateField}>
    <label htmlFor={id}>{label}</label>
    <div className={s.dateInput}>
      <input ref={input} id={id} type="date" name={name} value={value} min={value && value === original && value < today ? value : today} disabled={disabled} aria-haspopup="dialog" aria-expanded={opened}
        onChange={event => { const next = event.target.value; if (!next || next >= today || (next === original && value === original)) onChange(next) }} onClick={event => { event.preventDefault(); open() }}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ' || (event.altKey && event.key === 'ArrowDown')) { event.preventDefault(); open() } }} />
      <button type="button" disabled={disabled} onClick={open} aria-label={`${label}のカレンダーを開く`}><IconCalendar size={18} /></button>
    </div>
    <small aria-live="polite">{shortDate(value, true)}</small>
    {opened && createPortal(<dialog ref={element => { dialog.current = element; if (element && !element.open) element.showModal() }} className={s.calendar} aria-label={`${label}を選択`}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); close() }}>
      <div className={s.sectionHeading}><h2>{label}</h2><button type="button" onClick={close} aria-label="カレンダーを閉じる"><IconX size={18} /></button></div>
      <div className={s.calendarHeading}>
        <button type="button" disabled={month <= today.slice(0, 7)} onClick={() => moveMonth(-1)} aria-label="前の月"><IconChevronLeft size={18} /></button>
        <strong aria-live="polite">{first.getFullYear()}年{first.getMonth() + 1}月</strong>
        <button type="button" onClick={() => moveMonth(1)} aria-label="次の月"><IconChevronRight size={18} /></button>
      </div>
      <div className={s.calendarDays} aria-hidden="true">{['月', '火', '水', '木', '金', '土', '日'].map(day => <span key={day}>{day}</span>)}</div>
      <div className={s.calendarDays} role="group" aria-label="日付">
        {Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} />)}
        {Array.from({ length: count }, (_, i) => {
          const day = `${month}-${String(i + 1).padStart(2, '0')}`
          return <button key={day} type="button" disabled={day < today} data-date={day} tabIndex={day === active ? 0 : -1} aria-label={shortDate(day, true)} aria-pressed={day === value}
            aria-current={day === iso(new Date()) ? 'date' : undefined}
            onClick={() => { onChange(day); close() }} onKeyDown={event => {
              const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
              if (event.key === 'PageUp' || event.key === 'PageDown') { event.preventDefault(); moveMonth(event.key === 'PageUp' ? -1 : 1); return }
              const date = parse(day)
              const step = event.key === 'Home' ? -((date.getDay() + 6) % 7) : event.key === 'End' ? 6 - ((date.getDay() + 6) % 7) : steps[event.key]
              if (step === undefined) return
              event.preventDefault(); date.setDate(date.getDate() + step)
              if (date.getFullYear() < 1 || date.getFullYear() > 9999) return
              const next = iso(date) < today ? today : iso(date); setActive(next); setMonth(next.slice(0, 7))
            }}>{i + 1}</button>
        })}
      </div>
      <div className={s.formActions}><button type="button" onClick={() => { onChange(''); close() }}>日付をクリア</button><button type="button" onClick={() => { onChange(iso(new Date())); close() }}>今日</button></div>
    </dialog>, document.body)}
  </div>
}
