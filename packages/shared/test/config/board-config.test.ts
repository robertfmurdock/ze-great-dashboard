import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { boardConfigSchema, credentialEnvironmentNames } from '../../src/board-config.ts'

function panelConfig<PanelInput extends object>(panel: PanelInput) {
  return { boards: { a: { panels: [panel] } } }
}

const validConfig = panelConfig({ id: 'api-build', type: 'pipeline-status' })

describe('the example board configs', () => {
  const examplePath = fileURLToPath(new URL('../../../../boards/example.yaml', import.meta.url))

  test(
    'validates the example and preserves credential environment references',
    mint({
      setup: () => ({ config: parseYaml(readFileSync(examplePath, 'utf8')) }),
      exercise: ({ config }) => boardConfigSchema.safeParse(config),
      verify: (result, { config }) => {
        expect(result.error?.issues ?? []).toEqual([])
        expect(result.success).toBe(true)
        expect(result.data?.sources).toMatchObject(config.sources)
        expect(Object.values(config.sources)).toContainEqual(
          expect.objectContaining({ token_env: expect.any(String) }),
        )
        for (const source of Object.values(config.sources)) {
          expect(source).not.toHaveProperty('token')
          expect(source).not.toHaveProperty('password')
        }
      },
    }),
  )
})

describe('the board config schema', () => {
  describe('test artifact configuration', () => {
    test(
      'accepts a standalone panel with bounded artifact configuration',
      mint({
        setup: () => ({
          config: {
            boards: {
              team: {
                panels: [
                  {
                    id: 'tests',
                    type: 'test-count',
                    source: 'github',
                    pipeline: 'main.yml',
                    test_results: { artifact: 'ci-evidence', entry: 'test-summary.json' },
                  },
                ],
              },
            },
          },
        }),
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result) => expect(result.success).toBe(true),
      }),
    )
    test(
      'rejects a standalone panel without artifact configuration',
      mint({
        setup: () => ({
          config: {
            boards: {
              team: {
                panels: [
                  { id: 'tests', type: 'test-count', source: 'github', pipeline: 'main.yml' },
                ],
              },
            },
          },
        }),
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result) => expect(result.success).toBe(false),
      }),
    )
    test(
      'rejects an artifact entry outside the archive root',
      mint({
        setup: () => ({
          config: {
            boards: {
              team: {
                panels: [
                  {
                    id: 'tests',
                    type: 'test-count',
                    source: 'github',
                    pipeline: 'main.yml',
                    test_results: { artifact: 'ci-evidence', entry: '../summary.json' },
                  },
                ],
              },
            },
          },
        }),
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result) => expect(result.success).toBe(false),
      }),
    )
    const sources = [
      {
        name: 'accepts GitHub Actions run evidence',
        source: { type: 'github-actions', repo: 'example/repo' },
        accepted: true,
      },
      {
        name: 'rejects run evidence from an unsupported provider',
        source: { type: 'other-ci' },
        accepted: false,
      },
    ]
    for (const scenario of sources) {
      test(
        scenario.name,
        mint({
          setup: () => ({
            accepted: scenario.accepted,
            config: {
              sources: { github: scenario.source },
              boards: {
                team: {
                  panels: [
                    {
                      id: 'build',
                      type: 'pipeline-status',
                      source: 'github',
                      pipeline: 'main.yml',
                      test_results: { artifact: 'ci-evidence', entry: 'test-summary.json' },
                    },
                  ],
                },
              },
            },
          }),
          exercise: ({ config }) => boardConfigSchema.safeParse(config),
          verify: (result, { accepted }) => expect(result.success).toBe(accepted),
        }),
      )
    }
  })

  describe('deployment security', () => {
    for (const security of ['warn', 'required', 'unsecured'] as const) {
      test(
        `accepts the ${security} deployment policy`,
        mint({
          setup: () => ({ config: { ...validConfig, security } }),
          exercise: ({ config }) => boardConfigSchema.parse(config),
          verify: (result, { config }) => expect(result.security).toBe(config.security),
        }),
      )
    }
    test(
      'leaves an omitted security policy unset for warn behavior',
      mint({
        setup: () => ({ config: validConfig }),
        exercise: ({ config }) => boardConfigSchema.parse(config),
        verify: (result) => expect(result.security).toBeUndefined(),
      }),
    )
    test(
      'rejects contradictory explicit public access and authentication',
      mint({
        setup: () => ({
          config: {
            ...validConfig,
            security: 'unsecured',
            auth: {
              issuer: 'https://login.example.test',
              client_id: 'dashboard',
              audience: 'dashboard-api',
              allow: { subjects: ['person'] },
            },
          },
        }),
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result) => {
          expect(result.success).toBe(false)
          expect(result.error?.issues[0]?.message).toMatch(/unsecured.*auth/)
        },
      }),
    )
  })

  describe('pull-request build event restrictions', () => {
    const github = { type: 'github-actions', repo: 'example-org/example-repo' }
    const panel = { id: 'updates', type: 'pull-request-health', source: 'github' }
    test(
      'accepts GitHub Actions pull-request build events',
      mint({
        setup: () => ({
          config: {
            sources: { github },
            ...panelConfig({ ...panel, build_events: ['push', 'workflow_dispatch'] }),
          },
        }),
        exercise: ({ config }) => boardConfigSchema.parse(config),
        verify: (result, { config }) =>
          expect(result.boards.a?.panels[0]?.build_events).toEqual(
            config.boards.a.panels[0]?.build_events,
          ),
      }),
    )
    const invalidEvents = [
      { name: 'empty', buildEvents: [] },
      { name: 'duplicate', buildEvents: ['push', 'push'] },
      { name: 'unknown', buildEvents: ['typo-event'] },
    ]
    for (const scenario of invalidEvents) {
      test(
        `rejects ${scenario.name} build events`,
        mint({
          setup: () => ({
            config: {
              sources: { github },
              ...panelConfig({ ...panel, build_events: scenario.buildEvents }),
            },
          }),
          exercise: ({ config }) => boardConfigSchema.safeParse(config),
          verify: (result) => expect(result.success).toBe(false),
        }),
      )
    }
    test(
      'rejects build events on pipeline-status panels',
      mint({
        setup: () => ({
          config: {
            sources: { github },
            ...panelConfig({ ...panel, type: 'pipeline-status', build_events: ['push'] }),
          },
        }),
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result) => expect(result.success).toBe(false),
      }),
    )
  })

  describe('authorization policies', () => {
    const auth = { issuer: 'https://login.example.test', client_id: 'dashboard', audience: 'api' }
    const acceptedPolicies = [
      { name: 'authenticated', policy: { authorization: { mode: 'authenticated' } } },
      { name: 'subjects', policy: { authorization: { mode: 'subjects', subjects: ['person'] } } },
      {
        name: 'claim',
        policy: {
          authorization: {
            mode: 'claim',
            claim: 'https://example.test/roles',
            values: ['viewer'],
            match: 'any',
          },
        },
      },
      { name: 'legacy migration', policy: { allow: { subjects: ['legacy-person'] } } },
    ]
    for (const scenario of acceptedPolicies) {
      test(
        `accepts the ${scenario.name} policy`,
        mint({
          setup: () => ({ config: { ...validConfig, auth: { ...auth, ...scenario.policy } } }),
          exercise: ({ config }) => boardConfigSchema.safeParse(config),
          verify: (result) => expect(result.success).toBe(true),
        }),
      )
    }
    const rejectedPolicies = [
      { name: 'absent authorization', policy: {} },
      {
        name: 'competing authorization forms',
        policy: {
          authorization: { mode: 'authenticated' },
          allow: { subjects: ['legacy-person'] },
        },
      },
      {
        name: 'empty subject lists',
        policy: { authorization: { mode: 'subjects', subjects: [] } },
      },
      {
        name: 'empty claim names',
        policy: { authorization: { mode: 'claim', claim: '', values: ['viewer'], match: 'any' } },
      },
      {
        name: 'empty claim values',
        policy: { authorization: { mode: 'claim', claim: 'groups', values: [], match: 'all' } },
      },
      {
        name: 'invalid claim matching modes',
        policy: {
          authorization: { mode: 'claim', claim: 'groups', values: ['viewer'], match: 'either' },
        },
      },
    ]
    for (const scenario of rejectedPolicies) {
      test(
        `rejects ${scenario.name}`,
        mint({
          setup: () => ({ config: { ...validConfig, auth: { ...auth, ...scenario.policy } } }),
          exercise: ({ config }) => boardConfigSchema.safeParse(config),
          verify: (result) => expect(result.success).toBe(false),
        }),
      )
    }
  })

  describe('GitHub source authentication', () => {
    test(
      'rejects configuring a token and GitHub App on the same source',
      mint({
        setup: () => ({
          config: {
            ...validConfig,
            sources: {
              github: {
                type: 'github-actions',
                repo: 'example/repo',
                token_env: 'GITHUB_TOKEN',
                github_app: {
                  app_id_env: 'GITHUB_APP_ID',
                  private_key_env: 'GITHUB_APP_PRIVATE_KEY',
                  installation_id_env: 'GITHUB_APP_INSTALLATION_ID',
                },
              },
            },
          },
        }),
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result) => {
          expect(result.success).toBe(false)
          expect(result.error?.issues[0]?.message).toContain('token_env or github_app')
        },
      }),
    )
  })

  describe('Azure DevOps configuration', () => {
    const ado = { type: 'azure-devops', organization: 'example-org', project: 'Example Project' }
    const panel = { id: 'build', type: 'pipeline-status', source: 'ado', pipeline: 42 }
    const acceptedCredentials = [
      { name: 'PAT', credentials: { token_env: 'ADO_PAT' } },
      { name: 'Entra token-file', credentials: { entra_token_file_env: 'ADO_ENTRA_TOKEN_FILE' } },
    ]
    for (const scenario of acceptedCredentials) {
      test(
        `accepts Azure DevOps ${scenario.name} authentication with a numeric pipeline`,
        mint({
          setup: () => ({
            config: {
              ...panelConfig(panel),
              sources: { ado: { ...ado, ...scenario.credentials } },
            },
          }),
          exercise: ({ config }) => boardConfigSchema.safeParse(config),
          verify: (result) => expect(result.success).toBe(true),
        }),
      )
    }
    test(
      'rejects an Azure DevOps panel without a pipeline definition',
      mint({
        setup: () => ({
          config: {
            ...panelConfig({ id: panel.id, type: panel.type, source: panel.source }),
            sources: { ado: { ...ado, token_env: 'ADO_PAT' } },
          },
        }),
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result) => expect(result.success).toBe(false),
      }),
    )
    test(
      'rejects Azure DevOps authentication without credentials',
      mint({
        setup: () => ({ config: { ...panelConfig(panel), sources: { ado } } }),
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result) => expect(result.success).toBe(false),
      }),
    )
    test(
      'rejects competing Azure DevOps credential modes',
      mint({
        setup: () => ({
          config: {
            ...panelConfig(panel),
            sources: {
              ado: { ...ado, token_env: 'ADO_PAT', entra_token_file_env: 'ADO_ENTRA_TOKEN_FILE' },
            },
          },
        }),
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result) => expect(result.success).toBe(false),
      }),
    )
  })

  describe('credential-name projection', () => {
    test(
      'permits mixed source modes and reports only their declared credential names',
      mint({
        setup: () => {
          const pat = { type: 'github-actions', repo: 'example/pat', token_env: 'GITHUB_TOKEN' }
          const app = {
            type: 'github-actions',
            repo: 'example/app',
            github_app: {
              app_id_env: 'GITHUB_APP_ID',
              private_key_env: 'GITHUB_APP_PRIVATE_KEY',
              installation_id_env: 'GITHUB_APP_INSTALLATION_ID',
            },
          }
          const parsed = boardConfigSchema.parse({ ...validConfig, sources: { pat, app } })
          return {
            sources: Object.values(parsed.sources),
            expectedNames: [
              pat.token_env,
              app.github_app.app_id_env,
              app.github_app.private_key_env,
              app.github_app.installation_id_env,
            ],
          }
        },
        exercise: ({ sources }) => sources.flatMap(credentialEnvironmentNames),
        verify: (names, { expectedNames }) => expect(names).toEqual(expectedNames),
      }),
    )
  })

  describe('panel identity', () => {
    test(
      'rejects duplicate panel ids loudly rather than picking one',
      mint({
        setup: () => {
          const duplicateId = 'api-build'
          return {
            duplicateId,
            config: {
              boards: {
                a: {
                  panels: [
                    { id: duplicateId, type: 'pipeline-status' },
                    { id: duplicateId, type: 'http-value' },
                  ],
                },
              },
            },
          }
        },
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result, { duplicateId }) => {
          expect(result.success).toBe(false)
          expect(result.error?.issues[0]?.message).toContain(`duplicate panel id "${duplicateId}"`)
        },
      }),
    )
    const missingFields = [
      { name: 'id', panel: { type: 'pipeline-status' } },
      { name: 'type', panel: { id: 'x' } },
    ]
    for (const scenario of missingFields) {
      test(
        `requires a panel ${scenario.name}`,
        mint({
          setup: () => ({ config: panelConfig(scenario.panel) }),
          exercise: ({ config }) => boardConfigSchema.safeParse(config),
          verify: (result) => expect(result.success).toBe(false),
        }),
      )
    }
    test(
      'preserves an optional presentation label while retaining the stable id',
      mint({
        setup: () => {
          const panel = { id: 'build-main', type: 'pipeline-status', label: 'Build' }
          return { panel, config: panelConfig(panel) }
        },
        exercise: ({ config }) => boardConfigSchema.parse(config),
        verify: (result, { panel }) => expect(result.boards.a?.panels[0]).toMatchObject(panel),
      }),
    )
  })

  describe('panel positioning', () => {
    test(
      'treats position as optional',
      mint({
        setup: () => ({ config: validConfig }),
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result) => expect(result.success).toBe(true),
      }),
    )

    test(
      'preserves the zero-size preserved-but-hidden position sentinel',
      mint({
        setup: () => {
          const panel = {
            id: 'hidden',
            type: 'pipeline-status',
            position: { x: 0, y: 0, w: 0, h: 0 },
          }
          return { panel, config: panelConfig(panel) }
        },
        exercise: ({ config }) => boardConfigSchema.parse(config),
        verify: (result, { panel }) => expect(result.boards.a?.panels[0]).toMatchObject(panel),
      }),
    )
    test(
      'rejects partially zero-sized positions',
      mint({
        setup: () => ({
          config: panelConfig({
            id: 'partial',
            type: 'pipeline-status',
            position: { x: 0, y: 0, w: 0, h: 1 },
          }),
        }),
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result) => expect(result.success).toBe(false),
      }),
    )
  })

  describe('panel density', () => {
    test(
      'preserves omitted density',
      mint({
        setup: () => {
          const panel = { id: 'default', type: 'pipeline-status' }
          return { panel, config: panelConfig(panel) }
        },
        exercise: ({ config }) => boardConfigSchema.parse(config),
        verify: (result, { panel }) => expect(result.boards.a?.panels[0]).toMatchObject(panel),
      }),
    )
    for (const density of ['auto', 'comfortable', 'compact'] as const) {
      test(
        `preserves ${density} density`,
        mint({
          setup: () => {
            const panel = { id: 'density', type: 'http-value', density }
            return { panel, config: panelConfig(panel) }
          },
          exercise: ({ config }) => boardConfigSchema.parse(config),
          verify: (result, { panel }) =>
            expect(result.boards.a?.panels[0]?.density).toBe(panel.density),
        }),
      )
    }
    test(
      'rejects unknown density',
      mint({
        setup: () => ({
          config: panelConfig({ id: 'x', type: 'pipeline-status', density: 'dense' }),
        }),
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result) => expect(result.success).toBe(false),
      }),
    )
    test(
      'rejects the removed display setting',
      mint({
        setup: () => ({
          config: panelConfig({ id: 'x', type: 'pipeline-status', display: 'primary' }),
        }),
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result) => expect(result.success).toBe(false),
      }),
    )
  })

  describe('panel animation settings', () => {
    test(
      'preserves the local pipeline animation demo with ordinary metadata',
      mint({
        setup: () => {
          const panel = {
            id: 'active-run-treatments',
            type: 'pipeline-animation-demo',
            density: 'auto',
            position: { x: 0, y: 6, w: 12, h: 6 },
          }
          return { panel, config: panelConfig(panel) }
        },
        exercise: ({ config }) => boardConfigSchema.parse(config),
        verify: (result, { panel }) => expect(result.boards.a?.panels[0]).toMatchObject(panel),
      }),
    )
    test(
      'preserves configurable animation-demo durations',
      mint({
        setup: () => {
          const panel = {
            id: 'demo',
            type: 'pipeline-animation-demo',
            demo_run_duration: '45s',
            demo_review_duration: '2m',
          }
          return { panel, config: panelConfig(panel) }
        },
        exercise: ({ config }) => boardConfigSchema.parse(config),
        verify: (result, { panel }) => expect(result.boards.a?.panels[0]).toMatchObject(panel),
      }),
    )
    for (const animation of [
      'radial',
      'runway',
      'orbit',
      'signal-field',
      'telemetry-bloom',
      'release-transit',
      'status-weather',
      'falling-shapes',
      'snowman',
      'flight-path',
      'off',
    ] as const) {
      test(
        `preserves the ${animation} running animation`,
        mint({
          setup: () => {
            const panel = { id: 'build', type: 'pipeline-status', running_animation: animation }
            return { panel, config: panelConfig(panel) }
          },
          exercise: ({ config }) => boardConfigSchema.parse(config),
          verify: (result, { panel }) =>
            expect(result.boards.a?.panels[0]?.running_animation).toBe(panel.running_animation),
        }),
      )
    }
    test(
      'rejects unknown running animations',
      mint({
        setup: () => ({
          config: panelConfig({ id: 'build', type: 'pipeline-status', running_animation: 'laser' }),
        }),
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result) => expect(result.success).toBe(false),
      }),
    )
  })

  describe('board attention treatment', () => {
    const panels = [{ id: 'build', type: 'pipeline-status', attention: true }]
    test(
      'rejects an opted-in panel without a board treatment',
      mint({
        setup: () => ({ config: { boards: { a: { panels } } } }),
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result) => expect(result.success).toBe(false),
      }),
    )
    test(
      'accepts an opted-in panel with a board treatment',
      mint({
        setup: () => ({
          config: { boards: { a: { panels, attention: { treatment: 'beacon' } } } },
        }),
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result) => expect(result.success).toBe(true),
      }),
    )
    test(
      'rejects an unknown board treatment',
      mint({
        setup: () => ({ config: { boards: { a: { panels, attention: { treatment: 'flash' } } } } }),
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result) => expect(result.success).toBe(false),
      }),
    )
  })

  describe('polling duration configuration', () => {
    test(
      'rejects a malformed refresh instead of letting it become NaN later',
      mint({
        setup: () => ({
          config: { boards: { a: { refresh: 'soon', panels: [{ id: 'x', type: 'y' }] } } },
        }),
        exercise: ({ config }) => boardConfigSchema.safeParse(config),
        verify: (result) => expect(result.success).toBe(false),
      }),
    )
    for (const key of [
      'running_refresh',
      'running_completion_refresh',
      'running_completion_window',
    ] as const) {
      test(
        `rejects zero ${key} at board level`,
        mint({
          setup: () => ({
            config: {
              boards: { a: { [key]: '0s', panels: [{ id: 'x', type: 'pipeline-status' }] } },
            },
          }),
          exercise: ({ config }) => boardConfigSchema.safeParse(config),
          verify: (result) => expect(result.success).toBe(false),
        }),
      )
      test(
        `rejects malformed ${key} at panel level`,
        mint({
          setup: () => ({
            config: panelConfig({ id: 'x', type: 'pipeline-status', [key]: 'soon' }),
          }),
          exercise: ({ config }) => boardConfigSchema.safeParse(config),
          verify: (result) => expect(result.success).toBe(false),
        }),
      )
    }
  })

  describe('HTTP-value configuration', () => {
    describe('grouped HTTP value facts', () => {
      const grouped = {
        id: 'versions',
        type: 'http-value',
        facts: [
          {
            id: 'api',
            label: 'API',
            url: 'https://api.example.com/version',
            json_path: '$.version',
            link: 'https://status.example.com/api',
          },
          { id: 'web', label: 'Web', url: 'https://web.example.com/version' },
        ],
      }
      test(
        'preserves independently addressed HTTP facts and their public links',
        mint({
          setup: () => ({ panel: grouped, config: panelConfig(grouped) }),
          exercise: ({ config }) => boardConfigSchema.parse(config),
          verify: (result, { panel }) =>
            expect(result.boards.a?.panels[0]?.facts).toEqual(panel.facts),
        }),
      )
      test(
        'accepts four independently addressed facts',
        mint({
          setup: () => {
            const facts = Array.from({ length: 4 }, (_, index) => ({
              id: `fact-${index}`,
              label: `Fact ${index}`,
              url: `https://example.com/${index}`,
            }))
            return { facts, config: panelConfig({ ...grouped, facts }) }
          },
          exercise: ({ config }) => boardConfigSchema.parse(config),
          verify: (result, { facts }) => expect(result.boards.a?.panels[0]?.facts).toEqual(facts),
        }),
      )
      const rejectedGroups = [
        {
          name: 'a competing panel URL',
          panel: { ...grouped, url: 'https://example.com/ambiguous' },
        },
        {
          name: 'more than four facts',
          panel: {
            ...grouped,
            facts: Array.from({ length: 5 }, (_, index) => ({
              id: `fact-${index}`,
              label: `Fact ${index}`,
              url: `https://example.com/${index}`,
            })),
          },
        },
        {
          name: 'duplicate fact ids',
          panel: { ...grouped, facts: [grouped.facts[0], { ...grouped.facts[0], label: 'Copy' }] },
        },
        {
          name: 'malformed public links',
          panel: { ...grouped, facts: [{ ...grouped.facts[0], link: 'not a URL' }] },
        },
        {
          name: 'facts without labels',
          panel: { ...grouped, facts: [{ id: 'api', url: 'https://api.example.com/version' }] },
        },
      ]
      for (const scenario of rejectedGroups) {
        test(
          `rejects ${scenario.name}`,
          mint({
            setup: () => ({ config: panelConfig(scenario.panel) }),
            exercise: ({ config }) => boardConfigSchema.safeParse(config),
            verify: (result) => expect(result.success).toBe(false),
          }),
        )
      }
    })

    describe('editor-visible fields', () => {
      test(
        'preserves signal-specific HTTP value fields',
        mint({
          setup: () => {
            const panel = {
              id: 'v',
              type: 'http-value',
              url: 'https://x/version',
              json_path: '$.v',
            }
            return { panel, config: panelConfig(panel) }
          },
          exercise: ({ config }) => boardConfigSchema.parse(config),
          verify: (result, { panel }) => expect(result.boards.a?.panels[0]).toMatchObject(panel),
        }),
      )

      const invalidFields = [
        { name: 'malformed URLs', fields: { url: 'not a URL' } },
        {
          name: 'malformed JSON paths',
          fields: { url: 'https://example.com', json_path: 'version' },
        },
      ]
      for (const scenario of invalidFields) {
        test(
          `rejects ${scenario.name}`,
          mint({
            setup: () => ({
              config: panelConfig({ id: 'versions', type: 'http-value', ...scenario.fields }),
            }),
            exercise: ({ config }) => boardConfigSchema.safeParse(config),
            verify: (result) => expect(result.success).toBe(false),
          }),
        )
      }
    })
  })
})
