import { afterEach } from 'vitest'

// React 19 uses this marker to distinguish an act-enabled test environment from a browser.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Node 24 exposes an experimental global `localStorage` that warns when no backing file is
// configured. Browser-facing tests need an ephemeral browser storage implementation instead.
const values = new Map<string, string>()
const localStorage: Storage = {
  get length() {
    return values.size
  },
  clear() {
    values.clear()
  },
  getItem(key) {
    return values.get(key) ?? null
  },
  key(index) {
    return [...values.keys()][index] ?? null
  },
  removeItem(key) {
    values.delete(key)
  },
  setItem(key, value) {
    values.set(key, value)
  },
}

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorage })

afterEach(() => {
  values.clear()
})
