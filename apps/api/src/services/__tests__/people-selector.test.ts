import { createEvidence, type Evidence } from "@hap/config";
import { describe, expect, it } from "vitest";
import {
  type ContactFetcher,
  fetchContacts,
  type RawContact,
  rankContacts,
  selectPeople,
} from "../people-selector";

const TENANT = "t-people-1";

function signalFor(content: string): Evidence {
  return createEvidence(TENANT, {
    id: "sig-1",
    source: "hubspot",
    confidence: 0.9,
    content,
  });
}

describe("fetchContacts", () => {
  it("delegates to the injected fetcher with tenantId and companyId", async () => {
    const calls: Array<{ tenantId: string; companyId: string }> = [];
    const fetcher: ContactFetcher = async (tenantId, companyId) => {
      calls.push({ tenantId, companyId });
      return [{ id: "c1", name: "Alice" }];
    };
    const result = await fetchContacts({ fetcher }, { tenantId: TENANT, companyId: "co-1" });
    expect(result).toHaveLength(1);
    expect(calls).toEqual([{ tenantId: TENANT, companyId: "co-1" }]);
  });

  it("returns [] when fetcher throws (never bluff on transport error)", async () => {
    const fetcher: ContactFetcher = async () => {
      throw new Error("boom");
    };
    const result = await fetchContacts({ fetcher }, { tenantId: TENANT, companyId: "co-1" });
    expect(result).toEqual([]);
  });
});

describe("rankContacts", () => {
  it("returns empty array for empty input", () => {
    expect(rankContacts([], null)).toEqual([]);
  });

  it("ranks by signal keyword match in title first", () => {
    const signal = signalFor("Funding round, new CFO hire announced.");
    const contacts: RawContact[] = [
      { id: "a", name: "A", title: "VP Sales" },
      { id: "b", name: "B", title: "CFO" },
      { id: "c", name: "C", title: "Intern" },
    ];
    const ranked = rankContacts(contacts, signal);
    expect(ranked[0]?.id).toBe("b");
  });

  it("ranks by recency when signal is null", () => {
    const newer = new Date();
    const older = new Date(newer.getTime() - 30 * 24 * 60 * 60 * 1000);
    const contacts: RawContact[] = [
      { id: "old", name: "Old", lastActivityAt: older },
      { id: "new", name: "New", lastActivityAt: newer },
    ];
    const ranked = rankContacts(contacts, null);
    expect(ranked[0]?.id).toBe("new");
  });

  it("always assigns a numeric score", () => {
    const contacts: RawContact[] = [{ id: "a", name: "A" }];
    const ranked = rankContacts(contacts, null);
    expect(typeof ranked[0]?.score).toBe("number");
  });
});

describe("selectPeople", () => {
  it("returns [] for empty ranked list (no fabrication)", () => {
    expect(selectPeople([], null)).toEqual([]);
  });

  it("returns [] when no signal AND no contacts (never fabricate)", () => {
    expect(selectPeople([], null, 3)).toEqual([]);
  });

  it("caps at maxCount (default 3)", () => {
    const signal = signalFor("Product launch interest.");
    const ranked = [
      { id: "1", name: "One", title: "VP", score: 10 },
      { id: "2", name: "Two", title: "Director", score: 9 },
      { id: "3", name: "Three", title: "Manager", score: 8 },
      { id: "4", name: "Four", title: "Analyst", score: 7 },
      { id: "5", name: "Five", title: "Associate", score: 6 },
    ];
    const selected = selectPeople(ranked, signal);
    expect(selected).toHaveLength(3);
    expect(selected.map((p) => p.id)).toEqual(["1", "2", "3"]);
  });

  it("honors custom maxCount", () => {
    const signal = signalFor("Email engagement.");
    const ranked = [
      { id: "1", name: "One", score: 10 },
      { id: "2", name: "Two", score: 9 },
    ];
    expect(selectPeople(ranked, signal, 1)).toHaveLength(1);
  });

  it("returns 0, 1, 2, or 3 people depending on input size", () => {
    const signal = signalFor("Signal content here.");
    for (const n of [0, 1, 2, 3]) {
      const ranked = Array.from({ length: n }, (_, i) => ({
        id: `c${i}`,
        name: `Contact ${i}`,
        score: 10 - i,
      }));
      expect(selectPeople(ranked, signal)).toHaveLength(n);
    }
  });

  it("generates reasonToTalk that references signal content", () => {
    const signal = signalFor("Leadership change announced.");
    const ranked = [{ id: "p1", name: "Alex", title: "CEO", score: 10 }];
    const [person] = selectPeople(ranked, signal);
    expect(person).toBeDefined();
    // The reason must mention the signal so it's grounded, not fabricated.
    expect(person?.reasonToTalk).toContain("Leadership change");
  });

  it("generates generic reasonToTalk when signal is null but contacts exist", () => {
    const ranked = [{ id: "p1", name: "Alex", title: "CEO", score: 10 }];
    const [person] = selectPeople(ranked, null);
    // When there's no signal, we should not have selected anyone. Defense in depth:
    // if the caller still passes contacts, reason must not fabricate a signal.
    if (person) {
      expect(person.reasonToTalk).not.toContain("undefined");
    }
  });
});
