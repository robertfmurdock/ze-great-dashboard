process.env.AUTH0_FUNCTIONAL_STRICT = 'true'
delete process.env.AUTH0_FUNCTIONAL_SKIP
await import('./container-functional.mjs')
