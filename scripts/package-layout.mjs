export const packageLayout = [
  {
    id: 'aws',
    directory: 'packages/aws',
    publishFiles: [
      'dist',
      'client',
      'board-config.schema.json',
      'bootstrap',
      'template.yml',
      'template-ecs.yml',
    ],
  },
]

export const internalPackageLayout = [
  { id: 'shared', directory: 'packages/shared' },
  { id: 'core', directory: 'packages/core' },
  { id: 'aws', directory: 'packages/aws' },
]
