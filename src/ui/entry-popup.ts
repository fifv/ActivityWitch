import { byId } from './icons'

/** Delegate to mounted rows so virtualization never needs per-row listeners. */
export function bindEntryDetails(
  root: HTMLElement,
  selector: string,
  show: (row: HTMLElement, pin: boolean) => void,
) {
  root.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch' || e.buttons) return
    const row = (e.target as Element).closest<HTMLElement>(selector)
    if (row && !row.contains(e.relatedTarget as Node | null)) show(row, false)
  })
  root.addEventListener('focusin', (e) => {
    const row = (e.target as Element).closest<HTMLElement>(selector)
    if (row?.matches(':focus-visible')) show(row, false)
  })
  root.addEventListener('click', (e) => {
    const row = (e.target as Element).closest<HTMLElement>(selector)
    if (row) show(row, true)
  })
}

export class EntryPopup {
  private anchor?: HTMLElement
  private pinned = false
  private observer = new MutationObserver(() => {
    if (!this.anchor?.isConnected) this.close()
  })
  constructor(private card: HTMLElement) {
    byId('close-details').onclick = () => this.close()
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (
          this.anchor &&
          !this.card.contains(e.target as Node) &&
          !this.anchor.contains(e.target as Node)
        )
          this.close()
      },
      true,
    )
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close()
    })
    document.addEventListener(
      'scroll',
      (e) => {
        if (
          this.anchor &&
          e.target instanceof Node &&
          e.target.contains(this.anchor)
        )
          this.close()
      },
      true,
    )
    window.addEventListener('resize', () => this.close())
    window.addEventListener('blur', () => this.close())
  }
  private leave = () => {
    if (!this.pinned) this.close()
  }
  close() {
    if (!this.anchor) return
    this.anchor.removeEventListener('pointerleave', this.leave)
    this.anchor.removeEventListener('blur', this.leave)
    this.anchor.removeAttribute('aria-describedby')
    this.observer.disconnect()
    this.card.hidden = true
    this.anchor = undefined
    this.pinned = false
  }
  show(anchor: HTMLElement, pin: boolean, label: string, body: string) {
    if (this.pinned && !pin) return
    this.close()
    this.anchor = anchor
    this.pinned = pin
    byId('details-label').textContent = label
    byId('details-body').innerHTML = body
    byId('close-details').hidden = !pin
    this.card.setAttribute('role', pin ? 'dialog' : 'tooltip')
    this.card.dataset.pinned = String(pin)
    this.card.hidden = false
    this.card.scrollTop = 0
    anchor.setAttribute('aria-describedby', this.card.id)
    anchor.addEventListener('pointerleave', this.leave)
    anchor.addEventListener('blur', this.leave)
    if (anchor.parentElement)
      this.observer.observe(anchor.parentElement, { childList: true })
    const rect = anchor.getBoundingClientRect(),
      w = this.card.offsetWidth,
      h = this.card.offsetHeight,
      gap = 6
    let x = rect.right + gap,
      y = rect.top
    if (x + w > innerWidth - gap) {
      if (rect.left - w - gap >= gap) x = rect.left - w - gap
      else {
        x = rect.right - w
        y =
          rect.bottom + gap + h <= innerHeight - gap
            ? rect.bottom + gap
            : rect.top - h - gap
      }
    }
    this.card.style.left =
      Math.max(gap, Math.min(innerWidth - w - gap, x)) + 'px'
    this.card.style.top =
      Math.max(gap, Math.min(innerHeight - h - gap, y)) + 'px'
  }
}
