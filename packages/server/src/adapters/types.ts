/** A reviewed, fully-derived upstream request declared before the browser can invoke it. */
export type PermittedCall = { url: string; headers: Headers }
