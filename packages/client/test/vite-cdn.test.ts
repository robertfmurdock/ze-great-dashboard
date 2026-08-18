import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importMapFor, readCdnDependencyGraph } from '../vite-cdn.ts'

const fixture = async (bundle: string[] = []) => {
  const root = await mkdtemp(join(tmpdir(), 'vite-cdn-'))
  await mkdir(join(root, 'packages/client'), { recursive: true })
  await writeFile(
    join(root, 'packages/client/package.json'),
    JSON.stringify({
      name: '@fixture/client',
      dependencies: { '@fixture/shared': '*', react: '^19.2.8', bundled: '^1.0.0' },
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
      },
    }),
  )
  return {
    clientPackageJsonPath: join(root, 'packages/client/package.json'),
    packageLockPath: join(root, 'package-lock.json'),
  }
}

describe('CDN externalization graph', () => {
  it('follows workspace dependencies and uses exact lockfile versions', async () => {
    const graph = readCdnDependencyGraph(await fixture())

    expect(graph.dependencies).toEqual([
      { name: 'bundled', version: '1.0.0', url: 'https://esm.sh/bundled@1.0.0' },
      { name: 'react', version: '19.2.8', url: 'https://esm.sh/react@19.2.8' },
      { name: 'zod', version: '4.4.3', url: 'https://esm.sh/zod@4.4.3' },
    ])
    expect(graph.external('@fixture/shared')).toBe(false)
    expect(graph.external('react/jsx-runtime')).toBe(true)
    expect(graph.external('react-dom/client')).toBe(false)
  })

  it('keeps explicitly bundled packages out of the CDN map', async () => {
    const graph = readCdnDependencyGraph(await fixture(['bundled']))

    expect(graph.dependencies.map(({ name }) => name)).not.toContain('bundled')
    expect(graph.external('bundled/subpath')).toBe(false)
    expect(importMapFor(graph.dependencies).imports?.react).toBe('https://esm.sh/react@19.2.8')
    expect(importMapFor(graph.dependencies).imports?.['react/']).toBe(
      'https://esm.sh/react@19.2.8/',
    )
  })
})
