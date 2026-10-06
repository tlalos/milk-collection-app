export function pageBounds(total: number, requestedPage: number, size: number) {
  const pages = Math.max(1, Math.ceil(total / size))
  const page = Math.max(1, Math.min(requestedPage, pages))
  const start = (page - 1) * size
  return { page, pages, start, end: Math.min(start + size, total) }
}

export function selectPage(current: string[], pageIds: string[], checked: boolean) {
  const ids = new Set(pageIds)
  return checked ? [...new Set([...current, ...pageIds])] : current.filter(id => !ids.has(id))
}
