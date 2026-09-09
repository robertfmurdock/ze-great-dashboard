/** A stable numeric variation seed for decorative fields keyed by a panel's public id. */
export function visualSeed(value: string): number {
  return Array.from(value).reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0,
    7,
  )
}
