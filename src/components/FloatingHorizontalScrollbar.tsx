import { useEffect, useRef, useState, type RefObject } from 'react'
import './FloatingHorizontalScrollbar.css'

interface FloatingHorizontalScrollbarProps {
  targetRef: RefObject<HTMLDivElement | null>
  label: string
  refreshKey?: string
}

export function FloatingHorizontalScrollbar({ targetRef, label, refreshKey }: FloatingHorizontalScrollbarProps) {
  const scrollbarRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, width: 0, contentWidth: 0, visible: false })

  useEffect(() => {
    const target = targetRef.current
    if (!target) return

    const update = () => {
      const bounds = target.getBoundingClientRect()
      const next = {
        left: bounds.left,
        width: bounds.width,
        contentWidth: target.scrollWidth,
        visible: target.scrollWidth > target.clientWidth + 1 && bounds.top < window.innerHeight && bounds.bottom > window.innerHeight,
      }
      setPosition((current) => current.left === next.left && current.width === next.width &&
        current.contentWidth === next.contentWidth && current.visible === next.visible ? current : next)
      if (scrollbarRef.current) scrollbarRef.current.scrollLeft = target.scrollLeft
    }

    const observer = new ResizeObserver(update)
    observer.observe(target)
    if (target.firstElementChild) observer.observe(target.firstElementChild)
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    target.addEventListener('scroll', update, { passive: true })
    update()
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      target.removeEventListener('scroll', update)
    }
  }, [targetRef, refreshKey])

  return <div
    ref={scrollbarRef}
    className="floating-horizontal-scrollbar"
    aria-label={label}
    tabIndex={position.visible ? 0 : -1}
    style={{ left: position.left, width: position.width, visibility: position.visible ? 'visible' : 'hidden' }}
    onScroll={(event) => {
      if (targetRef.current) targetRef.current.scrollLeft = event.currentTarget.scrollLeft
    }}
  >
    <div style={{ width: position.contentWidth }} />
  </div>
}
