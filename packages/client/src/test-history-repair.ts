import { type Panel, retryAfterTime, testHistorySchema } from '@ze-great-dashboard/shared/browser'
import type { DiagnosticSink } from './diagnostics.ts'
import type { BrowserPanelMemory } from './panel-memory.ts'

type Candidate = { panel: Panel; path: string }

/** Idle work is driven by settled current polls, never by its own recurring timer. */
export class TestHistoryRepair {
  private readonly pending = new Map<string, Candidate>()
  private readonly activePolls = new Set<string>()
  private readonly healthy = new Set<string>()
  private controller?: AbortController
  private disposed = false

  constructor(
    private readonly options: {
      board: string
      memory: BrowserPanelMemory
      fetcher: typeof fetch
      diagnostics: DiagnosticSink
      onMerged: (panel: Panel) => void
      visible?: () => boolean
    },
  ) {}

  currentStarted(panelId: string) {
    this.activePolls.add(panelId)
  }

  currentSettled(panel: Panel, path: string, healthy: boolean, supported: boolean) {
    if (this.disposed) return
    this.activePolls.delete(panel.id)
    if (!supported) this.pending.delete(panel.id)
    if (healthy) this.healthy.add(panel.id)
    else this.healthy.delete(panel.id)
    if (healthy && supported) {
      this.options.memory.confirmTestPoll(this.options.board, panel)
      if (this.options.memory.testRepairDue(this.options.board, panel))
        this.pending.set(panel.id, { panel, path: `${path}/test-history` })
    }
    this.drain()
  }

  dispose() {
    this.disposed = true
    this.pending.clear()
    this.controller?.abort()
  }

  private drain() {
    if (
      this.disposed ||
      this.controller ||
      this.activePolls.size ||
      !(this.options.visible?.() ?? document.visibilityState === 'visible')
    )
      return
    for (const [id, candidate] of this.pending) {
      this.pending.delete(id)
      if (
        !this.healthy.has(id) ||
        !this.options.memory.testRepairDue(this.options.board, candidate.panel)
      )
        continue
      this.controller = new AbortController()
      void this.run(candidate, this.controller)
      return
    }
  }

  private async run({ panel, path }: Candidate, controller: AbortController) {
    const { board, memory, diagnostics } = this.options
    memory.beginTestRepair(board, panel)
    let result: ReturnType<typeof testHistorySchema.parse> | undefined
    let retryAt: number | undefined
    try {
      const response = await this.options.fetcher(path, { signal: controller.signal })
      retryAt = retryAfterTime(response.headers.get('retry-after'), Date.now())
      if (response.ok) result = testHistorySchema.parse(await response.json())
    } catch {
      // Repair is optional context; failure never changes current polling health.
    }
    if (!this.disposed && !controller.signal.aborted) {
      memory.finishTestRepair(board, panel, result, retryAt)
      diagnostics.record({
        kind: 'test-history-repair',
        panelId: panel.id,
        path,
        outcome: result?.complete ? 'complete' : result ? 'partial' : 'failed',
        inspectedRuns: result?.inspectedRuns ?? 0,
        samples: result?.samples.length ?? 0,
      })
      this.options.onMerged(panel)
    }
    this.controller = undefined
    this.drain()
  }
}
