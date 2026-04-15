/**
 * Experience — the unfiltered causal record of everything that happened.
 *
 * Spec path: DesignPartner/BicameralMind/RightHemisphere/Subconscious/Experience
 *
 * Not a log. Genesis. The ground truth from which everything is derived.
 *
 * Invariants:
 *   !complete — every event is recorded, nothing omitted
 *   !append-only — never deleted or modified
 *   !causal-ordering — stored in the order they occurred
 *   !session-bounded — each session is a distinct segment
 *
 * This module defines the types and serialization. I/O is the caller's job
 * (Tauri commands for disk, or in-memory for tests).
 */
import type { Disturbance } from "./continuousAttention";

// ── Types ──

/** One entry in the experience journal. */
export interface ExperienceEntry {
  /** Monotonic timestamp (ms since epoch). */
  timestamp: number;
  /** Which sigils were involved in this event. */
  sigils: string[];
  /** The disturbance this event produced. */
  disturbance: {
    total: number;
    displaced: { name: string; magnitude: number }[];
  };
  /** Whether the Subconscious judged this relevant to the active scope. */
  relevant: boolean;
  /** The sigil that was focused when this event occurred. */
  focus: string | null;
  /** Chat message, if this is a conversation event. */
  message?: { role: "user" | "assistant"; content: string };
}

/** A session header — written once at the start of each session file. */
export interface SessionHeader {
  /** Unique session identifier. */
  sessionId: string;
  /** When this session started (ms since epoch). */
  startedAt: number;
  /** The workspace root path. */
  workspace: string;
}

/** A complete session — header + entries. Used for reading. */
export interface Session {
  header: SessionHeader;
  entries: ExperienceEntry[];
}

// ── Serialization ──
// Format: JSONL (one JSON object per line).
// First line is always the session header. Subsequent lines are entries.
// This is append-friendly, streaming-friendly, and trivially parseable.

/** Serialize a session header to a JSONL line. */
export function serializeHeader(header: SessionHeader): string {
  return JSON.stringify({ type: "session", ...header });
}

/** Serialize an experience entry to a JSONL line. */
export function serializeEntry(entry: ExperienceEntry): string {
  return JSON.stringify({ type: "entry", ...entry });
}

/** Parse a JSONL session file into a Session. */
export function parseSession(content: string): Session | null {
  const lines = content.split("\n").filter(l => l.trim().length > 0);
  if (lines.length === 0) return null;

  const first = JSON.parse(lines[0]);
  if (first.type !== "session") return null;

  const header: SessionHeader = {
    sessionId: first.sessionId,
    startedAt: first.startedAt,
    workspace: first.workspace,
  };

  const entries: ExperienceEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parsed = JSON.parse(lines[i]);
    if (parsed.type !== "entry") continue;
    entries.push({
      timestamp: parsed.timestamp,
      sigils: parsed.sigils,
      disturbance: parsed.disturbance,
      relevant: parsed.relevant,
      focus: parsed.focus,
    });
  }

  return { header, entries };
}

/** Generate a session ID. Simple: timestamp + random suffix. */
export function newSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

/**
 * Convert a RightHemisphere ExperienceSegment into a persistable ExperienceEntry.
 */
export function toEntry(
  segment: { sigils: string[]; disturbance: Disturbance; timestamp: number; relevant: boolean; message?: { role: "user" | "assistant"; content: string } },
  focus: string | null,
): ExperienceEntry {
  const entry: ExperienceEntry = {
    timestamp: segment.timestamp,
    sigils: segment.sigils,
    disturbance: {
      total: segment.disturbance.total,
      displaced: segment.disturbance.displaced.map(d => ({ name: d.name, magnitude: d.magnitude })),
    },
    relevant: segment.relevant,
    focus,
  };
  if (segment.message) entry.message = segment.message;
  return entry;
}
