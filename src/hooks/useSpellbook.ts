/**
 * useSpellbook — loads the workspace's @Spellbook from disk.
 *
 * Spec path: DesignPartner/Spellbook
 *
 * Spell manifests live at `.private/spells/*.json` in the workspace
 * (the @Body of the DesignPartner inhabiting this @Idea). Each manifest
 * is converted to a Spell value with pure-function matches() and cast()
 * suitable for passing to consultSpellbook.
 *
 * Empty directory → empty Spellbook → every Disturbance lifts to LH.
 * Writing a new manifest file grows the book; the DP can do this via
 * ordinary file writes.
 */
import { useEffect, useMemo, useState } from "react";
import {
  emptySpellbook,
  type Disturbance,
  type Spell,
  type SpellResult,
  type Spellbook,
} from "sigil-core";
import {
  api,
  type SpellManifest,
  type SpellMatchRule,
  type SpellPayloadPredicate,
  type SpellAction,
} from "../tauri";

/**
 * Test a @Disturbance against a manifest's declarative match rule.
 * The kind must equal; every payload predicate must pass.
 */
function matchesRule(disturbance: Disturbance, rule: SpellMatchRule): boolean {
  if (disturbance.kind !== rule.kind) return false;
  if (!rule.payload) return true;
  const payload = (disturbance.payload ?? {}) as Record<string, unknown>;
  for (const [field, predicate] of Object.entries(rule.payload)) {
    const value = payload[field];
    if (typeof value !== "string") return false;
    if (!testPredicate(value, predicate)) return false;
  }
  return true;
}

function testPredicate(value: string, predicate: SpellPayloadPredicate): boolean {
  if ("equals" in predicate) return value === predicate.equals;
  if ("matches" in predicate) {
    try {
      return new RegExp(predicate.matches, "i").test(value);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Run a manifest's action sequence. Currently supports "reply" actions —
 * each produces part of a reply that concatenates into the Spell's result.
 * If the sequence is empty or all actions fail silently, return failure so
 * the Subconscious lifts (per !failure-escalates).
 */
function runActions(actions: SpellAction[]): SpellResult {
  const replyParts: string[] = [];
  for (const action of actions) {
    if (action.type === "reply") {
      replyParts.push(action.content);
    }
  }
  if (replyParts.length === 0) {
    return { success: false, summary: "no actions produced output" };
  }
  return { success: true, summary: replyParts.join("\n\n") };
}

function manifestToSpell(manifest: SpellManifest): Spell {
  return {
    name: manifest.name,
    situation: manifest.situation,
    matches: (d) => matchesRule(d, manifest.match),
    cast: () => runActions(manifest.actions),
  };
}

/**
 * Load the workspace's Spellbook. Re-runs when the workspace root changes.
 * Silently falls back to the empty Spellbook on any error so chat never breaks.
 */
export function useSpellbook(rootPath: string | null): Spellbook {
  const [manifests, setManifests] = useState<SpellManifest[]>([]);

  useEffect(() => {
    if (!rootPath) {
      setManifests([]);
      return;
    }
    let cancelled = false;
    api.listSpells(rootPath)
      .then((result) => { if (!cancelled) setManifests(result); })
      .catch((err) => {
        if (!cancelled) {
          console.warn("[Spellbook] failed to load:", err);
          setManifests([]);
        }
      });
    return () => { cancelled = true; };
  }, [rootPath]);

  return useMemo<Spellbook>(() => {
    if (manifests.length === 0) return emptySpellbook;
    return { spells: manifests.map(manifestToSpell) };
  }, [manifests]);
}
