import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import type { Plugin } from 'vite'

type PackageJson = {
  name?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  cdn?: { bundle?: string[] }
}

type LockPackage = PackageJson & {
  version?: string
  link?: boolean
  resolved?: string
}

type PackageLock = {
  packages?: Record<string, LockPackage>
}

export type CdnDependency = {
  name: string
  version: string
  url: string
}

export type CdnGraph = {
  dependencies: CdnDependency[]
  external: (id: string) => boolean
}

const packageNameFromImport = (id: string): string | undefined => {
  if (id.startsWith('@')) {
    const parts = id.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined
  }

  return id.split('/')[0]
}

const packagePath = (name: string) => `node_modules/${name}`

const packageLockEntry = (lock: PackageLock, key: string): LockPackage | undefined =>
  lock.packages?.[key]

const workspacePackageNames = (lock: PackageLock): Set<string> => {
  const names = new Set<string>()
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (key.startsWith('packages/') && entry.name) names.add(entry.name)
  }
  return names
}

/** Resolve an npm package as Node/npm would, using only package-lock v3's installed tree. */
const findInstalledPackage = (
  lock: PackageLock,
  name: string,
  fromKey: string,
): [string, LockPackage] | undefined => {
  let directory = dirname(fromKey)
  while (true) {
    const candidate = directory === '.' ? packagePath(name) : `${directory}/${packagePath(name)}`
    const entry = packageLockEntry(lock, candidate)
    if (entry) return [candidate, entry]
    if (directory === '.') break
    directory = dirname(directory)
  }

  // A lockfile may contain a package nested under a peer-dependent package but still expose
  // another exact installed copy at the root. This fallback also produces a useful error below
  // when npm's resolved tree is incomplete.
  const suffix = `/${packagePath(name)}`
  const match = Object.entries(lock.packages ?? {}).find(
    ([key]) => key === packagePath(name) || key.endsWith(suffix),
  )
  return match as [string, LockPackage] | undefined
}

const dependenciesOf = (entry: LockPackage): string[] => [
  ...Object.keys(entry.dependencies ?? {}),
  ...Object.keys(entry.optionalDependencies ?? {}),
  ...Object.keys(entry.peerDependencies ?? {}),
]

const findWorkspaceRoot = (start: string): string => {
  let directory = resolve(start)
  while (!existsSync(resolve(directory, 'package-lock.json'))) {
    const parent = dirname(directory)
    if (parent === directory)
      throw new Error('CDN externalization could not find package-lock.json')
    directory = parent
  }
  return directory
}

export const readCdnDependencyGraph = (options: {
  clientPackageJsonPath: string
  packageLockPath: string
}): CdnGraph => {
  const clientPackage = JSON.parse(
    readFileSync(options.clientPackageJsonPath, 'utf8'),
  ) as PackageJson
  const lock = JSON.parse(readFileSync(options.packageLockPath, 'utf8')) as PackageLock
  const workspaces = workspacePackageNames(lock)
  const bundled = new Set(clientPackage.cdn?.bundle ?? [])
  const seen = new Set<string>()
  const thirdParty = new Map<string, CdnDependency>()
  const clientKey = relative(
    dirname(options.packageLockPath),
    dirname(options.clientPackageJsonPath),
  )

  const visit = (name: string, fromKey: string): void => {
    const installed = findInstalledPackage(lock, name, fromKey)
    if (!installed) {
      throw new Error(
        `CDN externalization cannot resolve installed package "${name}" from "${fromKey}" in package-lock.json`,
      )
    }

    const [key, installedEntry] = installed
    const entry =
      installedEntry.link && installedEntry.resolved
        ? (packageLockEntry(lock, installedEntry.resolved) ?? installedEntry)
        : installedEntry
    const identity = `${key}:${name}`
    if (seen.has(identity)) return
    seen.add(identity)

    if (!workspaces.has(name)) {
      if (!entry.version) {
        throw new Error(
          `CDN externalization cannot represent workspace dependency "${name}" without a version`,
        )
      }
      if (!bundled.has(name)) {
        thirdParty.set(name, {
          name,
          version: entry.version,
          url: `https://esm.sh/${name}@${entry.version}`,
        })
      }
    }

    for (const dependency of dependenciesOf(entry)) visit(dependency, key)
  }

  for (const dependency of dependenciesOf(clientPackage)) visit(dependency, clientKey)

  const external = (id: string): boolean => {
    const name = packageNameFromImport(id)
    return name !== undefined && thirdParty.has(name)
  }

  return {
    dependencies: [...thirdParty.values()].sort((a, b) => a.name.localeCompare(b.name)),
    external,
  }
}

export const importMapFor = (
  dependencies: CdnDependency[],
): Record<string, Record<string, string>> => ({
  imports: Object.fromEntries(
    dependencies.flatMap(({ name, url }) => [
      [name, url],
      [`${name}/`, `${url}/`],
    ]),
  ),
})

export const cdnExternalization = (options?: {
  clientPackageJsonPath?: string
  packageLockPath?: string
}): Plugin => {
  const workspaceRoot = findWorkspaceRoot(process.cwd())
  const clientPackageJsonPath =
    options?.clientPackageJsonPath ?? resolve(workspaceRoot, 'packages/client/package.json')
  const packageLockPath = options?.packageLockPath ?? resolve(workspaceRoot, 'package-lock.json')
  let graph: CdnGraph

  return {
    name: 'cdn-externalization',
    apply: 'build',
    config() {
      graph = readCdnDependencyGraph({ clientPackageJsonPath, packageLockPath })
      return { build: { rollupOptions: { external: graph.external } } }
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!graph)
          throw new Error('CDN externalization graph was not initialized before HTML generation')
        const importMap = JSON.stringify(importMapFor(graph.dependencies))
        const tag = `<script type="importmap">${importMap}</script>`
        if (!html.includes('</head>'))
          throw new Error('CDN externalization requires an HTML <head>')
        return html.replace('</head>', `${tag}\n  </head>`)
      },
    },
  }
}
