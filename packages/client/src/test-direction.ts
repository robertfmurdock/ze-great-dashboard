import type { Envelope, TestCount, TestHistorySample } from '@ze-great-dashboard/shared/browser'
import { pipelineStatusSchema, testCountSchema } from '@ze-great-dashboard/shared/browser'

export type TestSample = TestHistorySample
export type TestDirection = {
  mode: 'zero' | 'jump' | 'holding' | 'trend' | 'change' | 'quiet'
  symbol: string
  delta: number
  emphasized: boolean
  totals: number[]
  explanation: string
}

export function reportedTests(
  envelope: Envelope,
): Extract<TestCount, { status: 'reported' }> | undefined {
  if (envelope.state !== 'ok') return
  const pipeline = pipelineStatusSchema.safeParse(envelope.signal)
  if (pipeline.success) {
    if (pipeline.data.status === 'running' || pipeline.data.testResults?.state !== 'ok') return
    const tests = pipeline.data.testResults.signal
    return tests.status === 'reported' ? tests : undefined
  }
  const tests = testCountSchema.safeParse(envelope.signal)
  return tests.success && tests.data.status === 'reported' ? tests.data : undefined
}

function largeChange(before: number, after: number) {
  const delta = Math.abs(after - before)
  return delta >= 20 && (before === 0 || delta / before >= 0.2)
}

/** Input is unique, chronologically ordered completed runs, not polls. */
export function classifyTestDirection(samples: readonly TestSample[]): TestDirection | undefined {
  const totals = samples.slice(-8).map((sample) => sample.total)
  const latest = totals.at(-1)
  if (latest === undefined) return
  const previous = totals.at(-2)
  let mode: TestDirection['mode'] = 'quiet'
  let baseline = previous ?? latest
  let span = Math.min(2, totals.length)
  if (previous !== undefined && latest === 0 && previous > 0) mode = 'zero'
  else if (previous !== undefined && largeChange(previous, latest)) mode = 'jump'
  else {
    for (let landing = totals.length - 3; landing >= 1; landing--) {
      const before = totals[landing - 1]
      const count = totals[landing]
      if (before === undefined || count === undefined) continue
      if (
        largeChange(before, count) &&
        totals
          .slice(landing + 1)
          .every((total) => Math.abs(total - count) <= Math.max(2, count * 0.02))
      ) {
        mode = 'holding'
        baseline = before
        span = totals.length - landing + 1
        break
      }
    }
    if (mode === 'quiet') {
      const changes = totals
        .slice(1)
        .map((total, index) => total - (totals[index] ?? total))
        .filter((delta) => delta !== 0)
      const net = latest - (totals[0] ?? latest)
      if (
        changes.length >= 3 &&
        Math.abs(net) >= 5 &&
        changes.every((delta) => Math.sign(delta) === Math.sign(net))
      ) {
        mode = 'trend'
        baseline = totals[0] ?? latest
        span = totals.length
      } else if (previous !== undefined && latest !== previous) mode = 'change'
    }
  }
  const delta = latest - baseline
  const symbol =
    mode === 'quiet'
      ? ''
      : mode === 'zero'
        ? '⚠ ↓'
        : mode === 'holding'
          ? '→'
          : mode === 'trend'
            ? delta > 0
              ? '↗'
              : '↘'
            : delta > 0
              ? '↑'
              : '↓'
  const percent =
    baseline > 0 ? ` (${delta > 0 ? '+' : ''}${((delta / baseline) * 100).toFixed(1)}%)` : ''
  const descriptions = {
    zero: `Reported zero tests; previously ${baseline.toLocaleString()}.`,
    jump: `Large jump: ${baseline.toLocaleString()} → ${latest.toLocaleString()} tests${percent}.`,
    holding: `Holding a new level: ${latest.toLocaleString()} tests, previously ${baseline.toLocaleString()}${percent}.`,
    trend: `Sustained ${delta > 0 ? 'increase' : 'decrease'}: ${baseline.toLocaleString()} → ${latest.toLocaleString()} tests${percent}.`,
    change: `Latest change: ${baseline.toLocaleString()} → ${latest.toLocaleString()} tests${percent}.`,
    quiet: `No clear count change. Latest: ${latest.toLocaleString()} tests.`,
  }
  return {
    mode,
    symbol,
    delta,
    emphasized: mode === 'zero' || mode === 'jump',
    totals,
    explanation: `${descriptions[mode]} Comparison: ${span} retained run reading${span === 1 ? '' : 's'}. History: ${totals.join(' → ')}. Source readings retained by this browser are included; this is not complete CI history or a measure of test quality.`,
  }
}

export function projectTestDirection(direction?: TestDirection) {
  if (!direction) return undefined
  return { mode: direction.mode, delta: direction.delta, totals: direction.totals }
}
