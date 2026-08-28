export type BrowserStorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function browserLocalStorage(): BrowserStorageLike | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function readBrowserJson<T>(
  storage: BrowserStorageLike | undefined,
  key: string,
): T | undefined {
  try {
    const raw = storage?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}

export function writeBrowserJson(
  storage: BrowserStorageLike | undefined,
  key: string,
  value: unknown,
) {
  try {
    storage?.setItem(key, JSON.stringify(value))
  } catch {
    // Browser storage is an optimization; callers retain their in-memory state.
  }
}

export function removeBrowserValue(storage: Pick<Storage, 'removeItem'> | undefined, key: string) {
  try {
    storage?.removeItem(key)
  } catch {
    // Storage can be unavailable in private browsing or restricted frames.
  }
}
