export const packageLayout = [
  {
    id: 'shared',
    directory: 'packages/shared',
    publishFiles: ['dist'],
  },
  {
    id: 'core',
    directory: 'packages/core',
    publishFiles: ['dist'],
    dependencyId: 'shared',
  },
  {
    id: 'aws',
    directory: 'packages/aws',
    publishFiles: ['dist', 'client', 'template.yml'],
    dependencyId: 'core',
  },
]
