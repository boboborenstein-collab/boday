// Keeps a chat thread pinned to its newest message unless the reader scrolled up.

export interface ScrollBox {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/** Within this many px of the bottom still counts as "at the bottom". */
export const STICK_THRESHOLD_PX = 80

export function nearBottom(box: ScrollBox, threshold = STICK_THRESHOLD_PX): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= threshold
}

export function createStickyScroll(threshold = STICK_THRESHOLD_PX) {
  let stick = true
  return {
    /** Call from the scroll handler; scrolling up stops following. */
    onScroll(box: ScrollBox) {
      stick = nearBottom(box, threshold)
    },
    /** Call after content changes. `force` for the panel opening or the user's own send. */
    onContent(box: ScrollBox, { force = false }: { force?: boolean } = {}) {
      if (!force && !stick) return
      box.scrollTop = box.scrollHeight
      stick = true
    },
  }
}
