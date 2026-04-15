import { describe, it, expect } from "vitest";
import {
  serializeHeader,
  serializeEntry,
  parseSession,
  newSessionId,
  toEntry,
} from "../../packages/sigil-core/src/experience";
import type { SessionHeader, ExperienceEntry } from "../../packages/sigil-core/src/experience";
import type { Disturbance } from "../../packages/sigil-core/src/continuousAttention";

const header: SessionHeader = {
  sessionId: "test-abc123",
  startedAt: 1700000000000,
  workspace: "/Users/vlad/my-sigil",
};

const entry: ExperienceEntry = {
  timestamp: 1700000001000,
  sigils: ["Alpha", "Beta"],
  disturbance: { total: 4, displaced: [{ name: "Alpha", magnitude: 3 }, { name: "Beta", magnitude: 1 }] },
  relevant: true,
  focus: "Root",
};

describe("Experience serialization", () => {
  it("round-trips a session through serialize/parse", () => {
    const content = [
      serializeHeader(header),
      serializeEntry(entry),
    ].join("\n");

    const session = parseSession(content);
    expect(session).not.toBeNull();
    expect(session!.header).toEqual(header);
    expect(session!.entries).toHaveLength(1);
    expect(session!.entries[0]).toEqual(entry);
  });

  it("handles multiple entries", () => {
    const entry2: ExperienceEntry = { ...entry, timestamp: 1700000002000, sigils: ["Gamma"] };
    const content = [
      serializeHeader(header),
      serializeEntry(entry),
      serializeEntry(entry2),
    ].join("\n");

    const session = parseSession(content);
    expect(session!.entries).toHaveLength(2);
    expect(session!.entries[0].timestamp).toBe(1700000001000);
    expect(session!.entries[1].timestamp).toBe(1700000002000);
  });

  it("handles empty content", () => {
    expect(parseSession("")).toBeNull();
    expect(parseSession("  \n  ")).toBeNull();
  });

  it("preserves !causal-ordering — entries come back in insertion order", () => {
    const entries = [1, 2, 3, 4, 5].map(i => ({
      ...entry,
      timestamp: 1700000000000 + i * 1000,
      sigils: [`Sigil${i}`],
    }));
    const content = [serializeHeader(header), ...entries.map(serializeEntry)].join("\n");
    const session = parseSession(content)!;
    for (let i = 1; i < session.entries.length; i++) {
      expect(session.entries[i].timestamp).toBeGreaterThan(session.entries[i - 1].timestamp);
    }
  });

  it("tolerates trailing newlines", () => {
    const content = serializeHeader(header) + "\n" + serializeEntry(entry) + "\n\n";
    const session = parseSession(content);
    expect(session!.entries).toHaveLength(1);
  });
});

describe("newSessionId", () => {
  it("generates unique ids", () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a).not.toBe(b);
  });

  it("contains no spaces or special chars", () => {
    const id = newSessionId();
    expect(id).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("toEntry", () => {
  it("converts a RightHemisphere segment into an ExperienceEntry", () => {
    const disturbance: Disturbance = {
      total: 5,
      displaced: [{ name: "Alpha", magnitude: 3 }, { name: "Beta", magnitude: 2 }],
    };
    const segment = { sigils: ["Alpha"], disturbance, timestamp: 1234, relevant: true };
    const result = toEntry(segment, "Root");
    expect(result.timestamp).toBe(1234);
    expect(result.sigils).toEqual(["Alpha"]);
    expect(result.disturbance.total).toBe(5);
    expect(result.focus).toBe("Root");
  });
});
