import { createContext, useContext, useEffect, useState } from 'react'

export const MotionPaused = createContext(false)

const query = '(prefers-reduced-motion: reduce)'

export function useReducedMotion() {
  const motionPaused = useContext(MotionPaused)
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    () => globalThis.matchMedia?.(query).matches ?? false,
  )

  useEffect(() => {
    const media = globalThis.matchMedia?.(query)
    if (!media) return
    const update = () => setSystemReducedMotion(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  return motionPaused || systemReducedMotion
}
