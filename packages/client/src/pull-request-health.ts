import type { PullRequestHealth } from '@ze-great-dashboard/shared'
import { formatCount } from './panel-formatting.ts'

export type PullRequestHealthCompactFacts = {
  primary: string
  secondary: string
  primaryDetail?: string
  title: string
}

/**
 * Keep the wall-facing version of this aggregate signal short without making the
 * server's prose summary part of the client contract.
 */
export function compactPullRequestHealthFacts(
  signal: PullRequestHealth,
): PullRequestHealthCompactFacts {
  const failedItem = [...signal.workflows, ...signal.pullRequests].find(
    (item) => item.status === 'failed',
  )

  if (failedItem) {
    return {
      primary: `${failedItem.label} failed`,
      secondary: `${formatCount(signal.workflows.length, 'workflow')} · ${formatCount(signal.pullRequests.length, 'open PR')}`,
      primaryDetail: failedItem.detail,
      title: `${signal.summary} — ${failedItem.label}: ${failedItem.detail}`,
    }
  }

  return {
    primary: formatCount(signal.workflows.length, 'workflow'),
    secondary: formatCount(signal.pullRequests.length, 'open PR'),
    title: signal.summary,
  }
}
