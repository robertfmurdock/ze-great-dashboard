export type SnowmanScheduleMode = 'snowfall' | 'arrival' | 'hop' | 'full'

export type SnowmanSchedule = {
  mode: SnowmanScheduleMode
  bodyStart: number
  bodyEnd: number
  headStart: number
  hopStart: number
  land: number
  settleEnd: number
  end: number
}

/** Derive one deterministic choreography from the complete expected run duration. */
export function snowmanSchedule(duration: number): SnowmanSchedule {
  const bodyWindow = duration * 0.25
  const headWindow = duration * 0.2
  const mode: SnowmanScheduleMode =
    bodyWindow < 700 || headWindow < 350
      ? 'snowfall'
      : headWindow < 530
        ? 'arrival'
        : headWindow < 1030
          ? 'hop'
          : 'full'
  const scale = clamp(
    (headWindow - (mode === 'full' ? 1030 : 530)) / (mode === 'full' ? 1620 : 620),
    0,
    1,
  )
  const roll = mode === 'full' ? 500 + 1000 * scale : 0
  const tail = mode === 'arrival' ? 0 : 180 + 70 * scale
  const hop = mode === 'arrival' ? Math.min(900, headWindow) : 350 + 550 * scale
  const end = duration * 0.95
  const land = end - tail
  return {
    mode,
    bodyStart: duration * 0.75 - Math.min(2500, bodyWindow),
    bodyEnd: duration * 0.75,
    headStart: land - hop - roll,
    hopStart: land - hop,
    land,
    settleEnd: land + (tail ? 120 + 60 * scale : 0),
    end,
  }
}

export function scheduleAmount(time: number, start: number, end: number) {
  return end === start ? Number(time >= end) : clamp((time - start) / (end - start), 0, 1)
}

export function smoothScheduleAmount(value: number) {
  return value * value * (3 - 2 * value)
}

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value))
}
