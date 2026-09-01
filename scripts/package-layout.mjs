export const packageLayout = [
  {
    id: 'client',
    directory: 'packages/client',
    publishFiles: [{ source: 'dist', destination: 'client' }],
  },
  {
    id: 'aws',
    directory: 'packages/aws',
    publishFiles: ['dist', 'bootstrap', 'template.yml', 'template-ecs.yml'],
  },
]

export const internalPackageLayout = [
  { id: 'shared', directory: 'packages/shared' },
  { id: 'core', directory: 'packages/core' },
  { id: 'aws', directory: 'packages/aws' },
]
