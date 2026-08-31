/** Embedded in the immutable client artifact; never supplied by the server at runtime. */
export const clientReleaseVersion = import.meta.env.RELEASE_VERSION ?? 'dev'
