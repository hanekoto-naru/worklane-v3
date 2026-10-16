import { useState } from 'react'
import type { ReactNode } from 'react'
import s from './App.module.css'

export default function Paged<T>({ items, children }: { items: T[]; children: (rows: T[]) => ReactNode }) {
  const [page, setPage] = useState(0)
  const count = Math.max(1, Math.ceil(items.length / 100))
  const current = Math.min(page, count - 1)
  return <>{children(items.slice(current * 100, (current + 1) * 100))}
    <div className={s.pagination}><span role="status">{items.length}件{items.length > 100 ? ` · ${current + 1} / ${count}ページ` : ''}</span>{items.length > 100 && <><button disabled={current === 0} onClick={() => setPage(current - 1)}>前の100件</button><button disabled={current === count - 1} onClick={() => setPage(current + 1)}>次の100件</button></>}</div>
  </>
}
