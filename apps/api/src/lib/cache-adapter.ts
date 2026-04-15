/**
 * Cache adapter abstraction.
 *
 * The {@link CacheAdapter} interface is the contract every in-process cache in
 * this service speaks. The default {@link InMemoryCacheAdapter} is fine for a
 * single API instance; multi-instance deployments (Slice 3+) swap in a
 * Redis-backed implementation without touching a single call site.
 *
 * This same adapter also backs the Slice 3 nonce store for HubSpot signed
 * request replay protection (audit advisory A1 in `docs/security/SECURITY.md`
 * §15) — the nonce store is conceptually just a tag-less TTL cache, so reusing
 * the contract keeps the surface small.
 *
 * Design notes:
 *  - `get` is lazy-evicting: expired entries return `undefined` but are only
 *    physically removed on the NEXT mutating call (`set`, `delete`,
 *    `invalidateByTag`, or `clear`). This keeps `get` allocation-free in the
 *    hot path and avoids surprising behaviour when two concurrent gets race.
 *  - Tags give O(tags) invalidation via a reverse-map `tag → Set<key>`. The
 *    config-resolver uses `tenant:${tenantId}` as its tag, so one call flushes
 *    a whole tenant's configs when their DB row changes.
 *  - Overwriting a key via `set` replaces its tag set entirely; old tags no
 *    longer reference the new value. This is the intuitive behaviour (a fresh
 *    `set` means "forget whatever you knew about this key") and lets callers
 *    safely rotate tags without a separate `clearTags(key)` call.
 */

/** Options for {@link CacheAdapter.set}. */
export type CacheSetOptions = {
  /** Time-to-live in milliseconds. Omitted = no expiry. */
  ttlMs?: number;
  /**
   * Tags to associate with this entry. Any call to
   * {@link CacheAdapter.invalidateByTag} matching one of these tags drops this
   * entry.
   */
  tags?: readonly string[];
};

/**
 * Contract for the in-process cache used by {@link ./config-resolver} and,
 * in Slice 3, the rate-limiter and the HubSpot signed-request nonce store.
 *
 * Implementations MUST be safe to call from async code that may be interleaved
 * within a single Node.js event loop; they do NOT need to be safe across
 * processes (use a shared store like Redis for that).
 */
export interface CacheAdapter {
  /**
   * Return the cached value for `key`, or `undefined` if it's missing or
   * expired. Does NOT eagerly delete expired entries — see the design note
   * above.
   */
  get<T>(key: string): T | undefined;

  /**
   * Store `value` under `key`. An existing entry for the same key is replaced
   * (including its previous tag set).
   */
  set<T>(key: string, value: T, options?: CacheSetOptions): void;

  /** Remove a specific key (and its tag associations). No-op if absent. */
  delete(key: string): void;

  /**
   * Remove every entry associated with `tag`. Entries with multiple tags are
   * dropped when ANY of their tags matches — a config-resolver entry tagged
   * both `tenant:A` and `kind:llm` is flushed by either
   * `invalidateByTag('tenant:A')` or `invalidateByTag('kind:llm')`.
   */
  invalidateByTag(tag: string): void;

  /**
   * Remove everything. Primarily for tests (`beforeEach`) and for the Slice 3
   * nonce store's periodic TTL sweep.
   */
  clear(): void;
}

/** Internal record kept per cache key. */
type Entry = {
  value: unknown;
  /** Absolute ms timestamp; `undefined` means no expiry. */
  expiresAt: number | undefined;
  tags: Set<string>;
};

/**
 * Default in-process {@link CacheAdapter} — a `Map<string, Entry>` plus a
 * reverse-map `tag → Set<key>` for tag invalidation.
 *
 * Not thread-safe across workers. For multi-instance deployments (Slice 3),
 * replace with a Redis-backed adapter that honours the same contract.
 */
export class InMemoryCacheAdapter implements CacheAdapter {
  private readonly store = new Map<string, Entry>();
  private readonly tagIndex = new Map<string, Set<string>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      // Lazy eviction: don't delete here (keeps `get` non-mutating so
      // concurrent reads see consistent semantics). The next mutating call
      // will sweep it.
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, options?: CacheSetOptions): void {
    // Drop any prior tag associations before writing the new entry so stale
    // tags can't later resurrect-and-invalidate the fresh value.
    const existing = this.store.get(key);
    if (existing) {
      this.detachTags(key, existing.tags);
    }

    const tags = new Set(options?.tags ?? []);
    const expiresAt = options?.ttlMs === undefined ? undefined : Date.now() + options.ttlMs;
    this.store.set(key, { value, expiresAt, tags });

    for (const tag of tags) {
      let keys = this.tagIndex.get(tag);
      if (!keys) {
        keys = new Set();
        this.tagIndex.set(tag, keys);
      }
      keys.add(key);
    }
  }

  delete(key: string): void {
    const entry = this.store.get(key);
    if (!entry) return;
    this.detachTags(key, entry.tags);
    this.store.delete(key);
  }

  invalidateByTag(tag: string): void {
    const keys = this.tagIndex.get(tag);
    if (!keys) return;
    // Copy first because `delete` mutates the same index we're iterating.
    for (const key of Array.from(keys)) {
      const entry = this.store.get(key);
      if (entry) {
        this.detachTags(key, entry.tags);
        this.store.delete(key);
      }
    }
    this.tagIndex.delete(tag);
  }

  clear(): void {
    this.store.clear();
    this.tagIndex.clear();
  }

  /** Remove `key` from every tag's reverse-map bucket it appears in. */
  private detachTags(key: string, tags: Set<string>): void {
    for (const tag of tags) {
      const bucket = this.tagIndex.get(tag);
      if (!bucket) continue;
      bucket.delete(key);
      if (bucket.size === 0) this.tagIndex.delete(tag);
    }
  }
}
