// Vitest global setup.
//
// The Node runtime this suite runs under exposes an experimental global
// `localStorage` (see the `--localstorage-file` warning) that shadows jsdom's
// own Storage implementation and lacks the standard methods. That breaks any
// code (and test seeding) that calls localStorage.setItem/getItem. To make the
// Web Storage API behave as it does in a browser, install a small in-memory
// Storage polyfill whenever the ambient localStorage is missing its methods.

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    }
  };
  return storage;
}

function isWorkingStorage(candidate: unknown): candidate is Storage {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as Storage).setItem === "function" &&
    typeof (candidate as Storage).getItem === "function"
  );
}

const globalScope = globalThis as unknown as { localStorage?: unknown; window?: { localStorage?: unknown } };

if (!isWorkingStorage(globalScope.localStorage)) {
  const memory = createMemoryStorage();
  Object.defineProperty(globalScope, "localStorage", { configurable: true, writable: true, value: memory });
  if (globalScope.window && !isWorkingStorage(globalScope.window.localStorage)) {
    Object.defineProperty(globalScope.window, "localStorage", {
      configurable: true,
      writable: true,
      value: memory
    });
  }
}
