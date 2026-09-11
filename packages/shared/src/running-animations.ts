/** The browser-visible active-run treatments supported by the board contract. */
export const visibleRunningAnimations = [
  'radial',
  'runway',
  'orbit',
  'signal-field',
  'telemetry-bloom',
  'release-transit',
  'status-weather',
  'falling-shapes',
  'snowman',
] as const

export type RunningAnimation = (typeof visibleRunningAnimations)[number] | 'off'
