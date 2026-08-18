import { defineConfig } from 'vitest/config'

/**
 * One test run for the whole repo, because `check` is the agent's entire feedback loop and a
 * multi-step one degrades output quality. Projects keep the client's DOM environment from being
 * imposed on the server's tests.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: './packages/shared',
          environment: 'node',
        },
      },
      {
        test: {
          name: 'core',
          root: './packages/core',
          environment: 'node',
        },
      },
      {
        test: {
          name: 'server',
          root: './packages/server',
          environment: 'node',
        },
      },
      {
        test: {
          name: 'client',
          root: './packages/client',
          environment: 'happy-dom',
        },
      },
      {
        test: {
          name: 'aws',
          root: './packages/aws',
          environment: 'node',
        },
      },
    ],
  },
})
