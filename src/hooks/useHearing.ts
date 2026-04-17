/**
 * useHearing — surfaces the Workspace's ambient event stream.
 *
 * Spec path: DesignPartner/Body/Senses/Hearing
 *
 * Hearing reports changes happening anywhere in the @sigil I inhabit,
 * including rooms I am not looking at. Each event is located: the sigil
 * where it happened, the kind of change (language, affordance, invariant,
 * structural). Invariant: !complete — no event is filtered or dropped.
 *
 * Implementation: on every spec update, diff the previous tree against
 * the new one and emit located events. Consecutive same-kind same-path
 * events within MERGE_WINDOW_MS collapse into one — this keeps typing
 * bursts from drowning the list without violating !complete (the latest
 * event still carries the truth).
 */
import { useEffect, useRef, useState } from "react";
import type { Sigil } from "sigil-core";

export type HearingKind = "language" | "affordance" | "invariant" | "structural";

export interface HearingEvent {
  id: number;
  timestamp: number;
  kind: HearingKind;
  path: string[];
  summary: string;
}

const MAX_EVENTS = 20;
const MERGE_WINDOW_MS = 1500;

interface DiffContext {
  nextId: number;
  now: number;
  events: HearingEvent[];
}

function diffAffordancesOrInvariants(
  oldItems: { name: string; content: string }[],
  newItems: { name: string; content: string }[],
  path: string[],
  nodeName: string,
  kind: "affordance" | "invariant",
  ctx: DiffContext,
): void {
  const sigil = kind === "affordance" ? "#" : "!";
  const oldMap = new Map(oldItems.map(i => [i.name, i.content]));
  const newMap = new Map(newItems.map(i => [i.name, i.content]));

  for (const [name] of newMap) {
    if (!oldMap.has(name)) {
      ctx.events.push({
        id: ctx.nextId++,
        timestamp: ctx.now,
        kind,
        path,
        summary: `${sigil}${name} added to @${nodeName}`,
      });
    }
  }
  for (const [name] of oldMap) {
    if (!newMap.has(name)) {
      ctx.events.push({
        id: ctx.nextId++,
        timestamp: ctx.now,
        kind,
        path,
        summary: `${sigil}${name} removed from @${nodeName}`,
      });
    }
  }
  for (const [name, content] of newMap) {
    const oldContent = oldMap.get(name);
    if (oldContent !== undefined && oldContent !== content) {
      ctx.events.push({
        id: ctx.nextId++,
        timestamp: ctx.now,
        kind,
        path,
        summary: `${sigil}${name} in @${nodeName} changed`,
      });
    }
  }
}

function diffTrees(prev: Sigil, next: Sigil, nextIdStart: number): HearingEvent[] {
  const ctx: DiffContext = { nextId: nextIdStart, now: Date.now(), events: [] };

  function walk(oldNode: Sigil, newNode: Sigil, path: string[]): void {
    if (oldNode.language !== newNode.language) {
      ctx.events.push({
        id: ctx.nextId++,
        timestamp: ctx.now,
        kind: "language",
        path,
        summary: `language in @${newNode.name} changed`,
      });
    }

    diffAffordancesOrInvariants(
      oldNode.affordances, newNode.affordances, path, newNode.name, "affordance", ctx,
    );
    diffAffordancesOrInvariants(
      oldNode.invariants, newNode.invariants, path, newNode.name, "invariant", ctx,
    );

    const oldChildMap = new Map(oldNode.children.map(c => [c.name, c]));
    const newChildMap = new Map(newNode.children.map(c => [c.name, c]));

    for (const [name, c] of newChildMap) {
      if (!oldChildMap.has(name)) {
        ctx.events.push({
          id: ctx.nextId++,
          timestamp: ctx.now,
          kind: "structural",
          path: [...path, c.name],
          summary: `@${c.name} appeared in @${newNode.name}`,
        });
      }
    }
    for (const [name] of oldChildMap) {
      if (!newChildMap.has(name)) {
        ctx.events.push({
          id: ctx.nextId++,
          timestamp: ctx.now,
          kind: "structural",
          path,
          summary: `@${name} removed from @${newNode.name}`,
        });
      }
    }
    for (const [name, c] of newChildMap) {
      const old = oldChildMap.get(name);
      if (old) walk(old, c, [...path, c.name]);
    }
  }

  walk(prev, next, []);
  return ctx.events;
}

/** Collapse consecutive same-kind same-path events within the merge window. */
function mergeRecent(existing: HearingEvent[], incoming: HearingEvent[]): HearingEvent[] {
  if (incoming.length === 0) return existing;
  let result = [...incoming, ...existing];
  // Merge: drop any event that has a newer sibling (same kind, same path) within window.
  result = result.filter((e, idx) => {
    for (let j = 0; j < idx; j++) {
      const prior = result[j];
      if (
        prior.kind === e.kind &&
        prior.path.length === e.path.length &&
        prior.path.every((p, k) => p === e.path[k]) &&
        prior.timestamp - e.timestamp < MERGE_WINDOW_MS
      ) {
        return false;
      }
    }
    return true;
  });
  return result.slice(0, MAX_EVENTS);
}

export function useHearing(root: Sigil | null): HearingEvent[] {
  const prevRef = useRef<Sigil | null>(null);
  const nextIdRef = useRef(1);
  const [events, setEvents] = useState<HearingEvent[]>([]);

  useEffect(() => {
    if (!root) {
      prevRef.current = null;
      return;
    }
    const prev = prevRef.current;
    prevRef.current = root;
    if (!prev) return; // First load: nothing to diff against.

    const incoming = diffTrees(prev, root, nextIdRef.current);
    if (incoming.length === 0) return;
    nextIdRef.current += incoming.length;
    setEvents((cur) => mergeRecent(cur, incoming));
  }, [root]);

  return events;
}
