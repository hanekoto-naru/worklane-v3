export function nextChoiceIndex(index: number, count: number, key: string): number | null {
  if (!count) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count
  return null
}
export type ChoiceOption = { value: string; label: string }
export function searchChoices(options: ChoiceOption[], query: string) {
  const term = query.trim().toLocaleLowerCase()
  return options.filter(option => option.label.toLocaleLowerCase().includes(term))
}

// Keep table semantics and native buttons for keyboard use; row whitespace is a pointer shortcut.
export function openFromRow(event: { target: EventTarget | null; currentTarget: HTMLElement }, open: () => void, disabled = false) {
  if (disabled || !(event.target instanceof Element) || event.target.closest('button,a,input,textarea,select') || window.getSelection()?.isCollapsed === false) return
  (event.currentTarget.querySelector<HTMLButtonElement>('button[data-row-action]:not(:disabled)') ?? event.currentTarget.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus()
  open()
}
