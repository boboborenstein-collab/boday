// Tactile + audible feedback for satisfying interactions.
//
// Both channels are best-effort and self-contained:
//   • Haptics use navigator.vibrate (Android / some PWAs; a no-op on iOS Safari).
//   • The chime is synthesised with the Web Audio API, so there is no asset to
//     ship and it works fully offline.
// Callers pass whether the user has these enabled (read from settings).

let audioCtx: AudioContext | null = null

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!audioCtx) audioCtx = new AC()
    return audioCtx
  } catch {
    return null
  }
}

/** A short, bright two-note "ding" — the sound of a task completing. */
export function chime(enabled: boolean) {
  if (!enabled) return
  const ac = ctx()
  if (!ac) return
  if (ac.state === 'suspended') void ac.resume()

  const now = ac.currentTime
  const notes = [880, 1318.5] // A5 → E6
  notes.forEach((freq, i) => {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const t = now + i * 0.08
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32)
    osc.connect(gain).connect(ac.destination)
    osc.start(t)
    osc.stop(t + 0.34)
  })
}

/** Light haptic tap. */
export function haptic(pattern: number | number[] = 12) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern)
    } catch {
      /* ignore */
    }
  }
}

/** Convenience: the full "I completed something" celebration feedback. */
export function celebrate(opts: { sound: boolean }) {
  haptic([10, 30, 14])
  chime(opts.sound)
}
