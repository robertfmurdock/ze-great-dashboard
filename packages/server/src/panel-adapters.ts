import type { Panel, Source } from '@ze-great-dashboard/shared'
import { fetchAzureDevOpsPipeline, permittedAzureDevOpsCalls } from './adapters/azure-devops.ts'
import {
  fetchGithubActionsPipeline,
  fetchGithubActionsTestCount,
  permittedGithubActionsCalls,
  testCountCapabilities,
} from './adapters/github-actions.ts'
import { fetchGitlabCiPipeline, permittedGitlabCiCalls } from './adapters/gitlab-ci.ts'
import { fetchHttpValue, permittedHttpValueCalls } from './adapters/http-value.ts'
import type { CredentialResolver } from './credentials.ts'
import type { GithubClient } from './github-auth.ts'
import type { AdapterResult } from './upstream.ts'

type ReadArgs = {
  panel: Panel
  source?: Source
  requestHeaders: Headers
  fetcher: typeof fetch
  credentials: CredentialResolver
  githubClient: GithubClient
}

export type ReadPanelAdapter = {
  destination: (panel: Panel, source: Source | undefined) => string
  fetch?: (args: ReadArgs) => Promise<AdapterResult>
}

/**
 * The registry is intentionally a short explicit list: it is reused for admission and dispatch,
 * but does not turn the proxy's bounded panel/source combinations into a generic plugin surface.
 */
export function readPanelAdapter(
  panel: Panel,
  source: Source | undefined,
): ReadPanelAdapter | undefined {
  if (panel.type === 'pipeline-status' && source?.type === 'github-actions') {
    permittedGithubActionsCalls(panel, source)
    return {
      destination: () => 'https://api.github.com',
      fetch: ({ source: _configuredSource, ...args }) =>
        fetchGithubActionsPipeline({ ...args, source }),
    }
  }
  if (panel.type === 'test-count' && source?.type === 'github-actions') {
    testCountCapabilities(panel, source)
    return {
      destination: () => 'https://api.github.com',
      fetch: ({ source: _configuredSource, ...args }) =>
        fetchGithubActionsTestCount({ ...args, source }),
    }
  }
  if (panel.type === 'pipeline-status' && source?.type === 'azure-devops') {
    permittedAzureDevOpsCalls(panel, source)
    return {
      destination: () => 'https://dev.azure.com',
      fetch: ({ source: _configuredSource, ...args }) =>
        fetchAzureDevOpsPipeline({ ...args, source }),
    }
  }
  if (panel.type === 'pipeline-status' && source?.type === 'gitlab-ci') {
    permittedGitlabCiCalls(panel, source)
    return {
      destination: (_panel, resolvedSource) =>
        resolvedSource && 'url' in resolvedSource && typeof resolvedSource.url === 'string'
          ? resolvedSource.url
          : 'https://gitlab.com',
      fetch: ({ source: _configuredSource, ...args }) => fetchGitlabCiPipeline({ ...args, source }),
    }
  }
  if (panel.type === 'http-value') {
    permittedHttpValueCalls(panel)
    return {
      destination: (configuredPanel) => configuredPanel.url ?? '',
      ...(panel.facts ? {} : { fetch: (args: ReadArgs) => fetchHttpValue(args) }),
    }
  }
  return undefined
}
