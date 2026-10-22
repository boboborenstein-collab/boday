// Installed before any store import. Node has no localStorage; zustand persist
// writes the cadence-v1 key synchronously through this map.

const memory = new Map<string, string>()

const storage = {
  get length() {
    return memory.size
  },
  clear() {
    memory.clear()
  },
  getItem(key: string) {
    return memory.has(key) ? memory.get(key)! : null
  },
  key(index: number) {
    return [...memory.keys()][index] ?? null
  },
  removeItem(key: string) {
    memory.delete(key)
  },
  setItem(key: string, value: string) {
    memory.set(key, String(value))
  },
}

Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
  writable: true,
})

const root = globalThis as typeof globalThis & { global?: typeof globalThis }
if (!root.global) root.global = globalThis
if (root.global !== globalThis) {
  Object.defineProperty(root.global, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  })
}
