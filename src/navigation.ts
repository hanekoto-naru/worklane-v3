export const pages = ['dashboard', 'mine', 'delegated', 'projects', 'settings'] as const
export type Page = typeof pages[number]
export function pageFromHash(hash: string): Page {
  if (hash === '#/notes') return 'mine'
  return pages.find(page => hash === `#/${page}`) ?? 'dashboard'
}
export const pageHash = (page: Page) => `#/${page}`
