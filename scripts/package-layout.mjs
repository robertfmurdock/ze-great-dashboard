export const packageLayout = [
  {
    id: 'aws',
    directory: 'packages/aws',
    publishFiles: ['dist', 'client', 'template.yml'],
  },
]

export const internalPackageLayout = [
  { id: 'shared', directory: 'packages/shared' },
  { id: 'core', directory: 'packages/core' },
  { id: 'aws', directory: 'packages/aws' },
]
