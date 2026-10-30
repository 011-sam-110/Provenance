// Tiny SSR-safe localStorage helper used by the calm-console shell stores.
//
// Everything is wrapped so it is a no-op on the server / in private mode / when
// the quota is blown. Values are versioned: a schema bump invalidates old data
// (returns null → the store keeps its defaults) instead of crashing on a stale
// shape. `storage` is injectable so the round-trip + version guard are unit
// testable in the node vitest environment (no real `window`).

export interface PersistEnvelope<T> {
  v: number;
  d: T;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null; // SecurityError in some sandboxed iframes
  }
}

/** Read + validate a persisted value. Returns null on miss / version mismatch / corruption. */
export function loadPersisted<T>(key: string, version: number, storage?: StorageLike): T | null {
  const s = resolveStorage(storage);
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const env = JSON.parse(raw) as PersistEnvelope<T> | null;
    if (!env || typeof env !== "object" || env.v !== version) return null;
    return env.d;
  } catch {
    return null;
  }
}

/** Persist a value under a versioned envelope. Silently no-ops if storage is unavailable. */
export function savePersisted<T>(key: string, version: number, value: T, storage?: StorageLike): void {
  const s = resolveStorage(storage);
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify({ v: version, d: value } satisfies PersistEnvelope<T>));
  } catch {
    /* quota exceeded / private mode — non-fatal */
  }
}

/**
 * Forget a persisted value: the key is removed, not overwritten with a default, so a
 * person who resets goes back to being someone who never chose. Silently no-ops if
 * storage is unavailable.
 */
export function removePersisted(key: string, storage?: StorageLike): void {
  const s = resolveStorage(storage);
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    /* private mode / blocked storage: non-fatal */
  }
}
