import type { PipelineActivity } from '@ze-great-dashboard/shared'

export function formatPipelineActivity(activity: PipelineActivity | undefined) {
  if (!activity) return 'Activity unavailable'
  return activity.parent ? `${activity.parent} › ${activity.name}` : activity.name
}
