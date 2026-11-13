import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { z } from 'zod'
import { startup } from './startup.ts'

const deploymentSchema = z.strictObject({
  ASSET_PATH: z.string().min(1),
  BOARD_CONFIG_URL: z.string().min(1),
  BOARD: z.string().min(1).optional(),
})

function validHostname(hostname: string): boolean {
  return (
    hostname.length <= 253 &&
    hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  )
}

export async function startHostedDeployments(file: string, env = process.env) {
  const deployments = z
    .record(z.string(), deploymentSchema)
    .parse(parse(await readFile(file, 'utf8')))
  const hostnames = Object.keys(deployments).map((hostname) => hostname.toLowerCase())
  if (
    hostnames.length === 0 ||
    new Set(hostnames).size !== hostnames.length ||
    hostnames.some((hostname) => !validHostname(hostname))
  ) {
    throw new Error('DASHBOARD_HOSTS_FILE must define unique, valid hostnames.')
  }

  const instances = await Promise.all(
    Object.entries(deployments).map(async ([hostname, deployment]) => {
      const instance = await startup({ env: { ...env, ...deployment, BOARD: deployment.BOARD } })
      return [hostname.toLowerCase(), instance] as const
    }),
  )
  const byHostname = new Map(instances)
  const config = instances[0]?.[1].config
  if (!config) throw new Error('DASHBOARD_HOSTS_FILE must define at least one deployment.')

  return {
    config: { ...config, board: undefined },
    fetch(request: Request) {
      const authority = request.headers.get('host') ?? new URL(request.url).host
      const hostname = /^([a-z0-9.-]+)(?::[0-9]+)?$/i.exec(authority)?.[1]?.toLowerCase()
      const deployment = hostname ? byHostname.get(hostname) : undefined
      return deployment?.app.fetch(request) ?? new Response('Not Found', { status: 404 })
    },
  }
}
