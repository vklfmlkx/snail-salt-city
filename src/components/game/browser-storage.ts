/** Browser storage is a convenience; authoritative saves live on the server.
 * A blocked/full storage area falls back to memory for this tab, never crashes
 * rendering or stops an already-settled action. No global storage is cleared.
 */
export function createBrowserStorage(resolve: () => Storage) {
  const memory = new Map<string, string | null>();
  const dirty = new Set<string>();
  const storage = {
    getItem(key: string): string | null {
      if (dirty.has(key)) return memory.get(key) ?? null;
      try {
        const value = resolve().getItem(key);
        memory.set(key, value);
        return value;
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem(key: string, value: string) {
      memory.set(key, value);
      try {
        resolve().setItem(key, value);
        dirty.delete(key);
      } catch {
        dirty.add(key);
      }
    },
    removeItem(key: string) {
      memory.set(key, null);
      try {
        resolve().removeItem(key);
        dirty.delete(key);
      } catch {
        dirty.add(key);
      }
    },
    clearPrefix(prefix: string) {
      const keys = new Set(memory.keys());
      try {
        Object.keys(resolve()).forEach((key) => keys.add(key));
      } catch {}
      for (const key of keys)
        if (key.startsWith(prefix)) storage.removeItem(key);
    },
  };
  return storage;
}
export const sessionCache = createBrowserStorage(() => window.sessionStorage);
export const localCache = createBrowserStorage(() => window.localStorage);
