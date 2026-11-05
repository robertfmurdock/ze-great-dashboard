import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResourceScope } from '@continuous-excellence/testmints-js'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, it } from 'vitest'
import { importMapFor, readCdnDependencyGraph } from '../vite-cdn.ts'

describe('CDN externalization graph', () => {
  describe('lockfile graph resolution', () => {
    const fixture = async (scope: ResourceScope, bundle: string[] = []) => {
      const root = await mkdtemp(join(tmpdir(), 'vite-cdn-'))
      scope.defer('CDN graph directory', () => rm(root, { recursive: true, force: true }))
      await mkdir(join(root, 'packages/client'), { recursive: true })
      await writeFile(
        join(root, 'packages/client/package.json'),
        JSON.stringify({
          name: '@fixture/client',
          dependencies: {
            '@fixture/shared': '*',
            react: '^19.2.8',
            bundled: '^1.0.0',
            'react-consumer': '^1.0.0',
          },
          cdn: { bundle },
        }),
      )
      await writeFile(
        join(root, 'package-lock.json'),
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            'packages/client': {},
            'packages/shared': {
              name: '@fixture/shared',
              dependencies: { zod: '^4.4.3' },
            },
            'node_modules/@fixture/shared': { link: true, resolved: 'packages/shared' },
            'node_modules/react': { version: '19.2.8' },
            'node_modules/zod': { version: '4.4.3' },
            'node_modules/bundled': { version: '1.0.0' },
            'node_modules/react-consumer': {
              version: '1.0.0',
              peerDependencies: { react: '>=16.0.0' },
            },
          },
        }),
      )
      return {
        clientPackageJsonPath: join(root, 'packages/client/package.json'),
        packageLockPath: join(root, 'package-lock.json'),
      }
    }

    it(
      'follows workspace dependencies and uses exact lockfile versions',
      mint({
        setup: ({ scope }) => fixture(scope),
        exercise: (input) => readCdnDependencyGraph(input),
        verify: (graph) => {
          expect(graph.dependencies).toEqual([
            { name: 'bundled', version: '1.0.0', url: 'https://esm.sh/bundled@1.0.0' },
            { name: 'react', version: '19.2.8', url: 'https://esm.sh/react@19.2.8' },
            {
              name: 'react-consumer',
              version: '1.0.0',
              url: 'https://esm.sh/react-consumer@1.0.0?external=react',
            },
            { name: 'zod', version: '4.4.3', url: 'https://esm.sh/zod@4.4.3' },
          ])
          expect(graph.external('@fixture/shared')).toBe(false)
          expect(graph.external('react/jsx-runtime')).toBe(true)
          expect(graph.external('react-dom/client')).toBe(false)
        },
      }),
    )

    it(
      'keeps explicitly bundled packages out of the CDN map',
      mint({
        setup: ({ scope }) => fixture(scope, ['bundled']),
        exercise: (input) => readCdnDependencyGraph(input),
        verify: (graph) => {
          expect(graph.dependencies.map(({ name }) => name)).not.toContain('bundled')
          expect(graph.external('bundled/subpath')).toBe(false)
        },
      }),
    )
  })

  describe('import-map generation', () => {
    it(
      'keeps esm.sh external parameters off subpath mappings',
      mint({
        setup: () => ({
          dependencies: [
            {
              name: 'react-dom',
              version: '19.2.8',
              url: 'https://esm.sh/react-dom@19.2.8?external=react',
            },
          ],
        }),
        exercise: ({ dependencies }) => importMapFor(dependencies),
        verify: (result) => {
          expect(result.imports).toEqual({
            'react-dom': 'https://esm.sh/react-dom@19.2.8?external=react',
            'react-dom/': 'https://esm.sh/react-dom@19.2.8/',
          })
        },
      }),
    )
  })
})
