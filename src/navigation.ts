export const pages = ['dashboard', 'mine', 'delegated', 'notes', 'projects', 'settings'] as const
export type Page = typeof pages[number]
export function pageFromHash(hash: string): Page {
  return pages.find(page => hash === `#/${page}`) ?? 'dashboard'
}
export const pageHash = (page: Page) => `#/${page}`
