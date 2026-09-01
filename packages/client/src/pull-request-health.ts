import type { PullRequestHealth } from '@ze-great-dashboard/shared'
import { formatCount } from './panel-formatting.ts'

export type PullRequestHealthCompactFacts = {
  workflow: string
  pullRequests: string
  primary: string
  secondary: string
  primaryDetail?: string
  primaryKind?: 'failed' | 'warning'
  title: string
}

/**
 * Keep the wall-facing version of this aggregate signal short without making the
 * server's prose summary part of the client contract.
 */
export function compactPullRequestHealthFacts(
  signal: PullRequestHealth,
): PullRequestHealthCompactFacts {
  const attentionItem = [...signal.workflows, ...signal.pullRequests].find(
    (item) => item.status === 'failed' || item.status === 'warning',
  )

  if (attentionItem) {
    return {
      workflow: formatCount(signal.workflows.length, 'workflow'),
      pullRequests: formatCount(signal.pullRequests.length, 'open PR'),
      primary: `${attentionItem.label} ${attentionItem.status}`,
      secondary: `${formatCount(signal.workflows.length, 'workflow')} · ${formatCount(signal.pullRequests.length, 'open PR')}`,
      primaryDetail: attentionItem.detail,
      primaryKind: attentionItem.status === 'warning' ? 'warning' : 'failed',
      title: `${signal.summary} — ${attentionItem.label}: ${attentionItem.detail}`,
    }
  }

  return {
    workflow: formatCount(signal.workflows.length, 'workflow'),
    pullRequests: formatCount(signal.pullRequests.length, 'open PR'),
    primary: formatCount(signal.workflows.length, 'workflow'),
    secondary: formatCount(signal.pullRequests.length, 'open PR'),
    title: signal.summary,
  }
}
