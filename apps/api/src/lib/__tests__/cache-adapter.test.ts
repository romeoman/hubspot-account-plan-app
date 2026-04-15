import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryCacheAdapter } from "../cache-adapter";

describe("InMemoryCacheAdapter", () => {
  let cache: InMemoryCacheAdapter;

  beforeEach(() => {
    cache = new InMemoryCacheAdapter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("set/get round-trips a value", () => {
    cache.set("k", { hello: "world" });
    expect(cache.get("k")).toEqual({ hello: "world" });
  });

  it("returns undefined for a missing key", () => {
    expect(cache.get("nope")).toBeUndefined();
  });

  it("honors ttlMs — value expires after ttlMs and returns undefined", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000));
    cache.set("k", "v", { ttlMs: 100 });
    expect(cache.get("k")).toBe("v");

    vi.setSystemTime(new Date(1_000_000 + 101));
    expect(cache.get("k")).toBeUndefined();
  });

  it("treats missing ttlMs as no expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000));
    cache.set("k", "forever");
    vi.setSystemTime(new Date(10_000_000_000));
    expect(cache.get("k")).toBe("forever");
  });

  it("delete removes a specific key", () => {
    cache.set("a", 1);
    cache.set("b", 2);
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
  });

  it("invalidateByTag removes all entries with that tag and only those", () => {
    cache.set("a", 1, { tags: ["tenant:a"] });
    cache.set("b", 2, { tags: ["tenant:b"] });
    cache.set("c", 3, { tags: ["tenant:a"] });
    cache.set("d", 4); // untagged

    cache.invalidateByTag("tenant:a");

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBeUndefined();
    expect(cache.get("d")).toBe(4);
  });

  it("an entry with multiple tags is dropped when ANY of its tags is invalidated", () => {
    cache.set("multi", "v", { tags: ["tenant:a", "kind:llm"] });
    cache.invalidateByTag("kind:llm");
    expect(cache.get("multi")).toBeUndefined();
  });

  it("invalidateByTag on an unknown tag is a no-op", () => {
    cache.set("a", 1, { tags: ["tenant:a"] });
    cache.invalidateByTag("tenant:zzz");
    expect(cache.get("a")).toBe(1);
  });

  it("clear empties everything (tagged and untagged)", () => {
    cache.set("a", 1, { tags: ["tenant:a"] });
    cache.set("b", 2);
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();

    // And tag invalidation after clear is a no-op (no residual reverse-map).
    cache.set("c", 3, { tags: ["tenant:a"] });
    cache.invalidateByTag("tenant:a");
    expect(cache.get("c")).toBeUndefined();
  });

  it("overwriting a key replaces tags (old tags don't invalidate new value)", () => {
    cache.set("k", 1, { tags: ["old-tag"] });
    cache.set("k", 2, { tags: ["new-tag"] });
    cache.invalidateByTag("old-tag");
    expect(cache.get("k")).toBe(2);
    cache.invalidateByTag("new-tag");
    expect(cache.get("k")).toBeUndefined();
  });
});
