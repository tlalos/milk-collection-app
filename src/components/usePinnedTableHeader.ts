import { useLayoutEffect, type RefObject } from 'react'

export function usePinnedTableHeader(wrapperRef: RefObject<HTMLDivElement | null>, toolbarRef: RefObject<HTMLElement | null>, tableKey = '') {
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    const toolbar = toolbarRef.current
    const table = wrapper?.querySelector('table')
    const header = table?.tHead
    if (!wrapper || !toolbar || !table || !header) return
    let frame = 0
    // Pin the real header vertically while preserving the table's horizontal scroll alignment.
    const update = () => {
      frame = 0
      const offset = Math.max(0, Math.min(
        toolbar.getBoundingClientRect().bottom - table.getBoundingClientRect().top,
        table.offsetHeight - header.offsetHeight,
      ))
      header.style.transform = `translateY(${offset}px)`
    }
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update) }
    const observer = new ResizeObserver(schedule)
    observer.observe(table)
    observer.observe(toolbar)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    update()
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      header.style.transform = ''
    }
  }, [wrapperRef, toolbarRef, tableKey])
}
