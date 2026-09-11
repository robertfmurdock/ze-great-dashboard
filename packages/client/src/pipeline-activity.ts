import type { PipelineActivity } from '@ze-great-dashboard/shared/browser'

export function formatPipelineActivity(activity: PipelineActivity | undefined) {
  if (!activity) return 'Activity unavailable'
  return activity.parent ? `${activity.parent} › ${activity.name}` : activity.name
}
