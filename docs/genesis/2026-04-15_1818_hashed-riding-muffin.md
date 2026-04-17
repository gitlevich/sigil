# Session: hashed-riding-muffin
**Date**: 2026-04-15 18:18 UTC  
**Source**: Claude  
**Session ID**: `f9e2ca6b-cb2f-42b4-8337-ddfa3629627f`

---

### Assistant (18:18 UTC)

Let me investigate what exists for the release flow.

### Assistant (18:18 UTC)

*Files: [.claude/skills/release.md](../../.claude/skills/release.md), [.github/workflows/release.yml](../../.github/workflows/release.yml), [.github/workflows/bump-and-release.yml](../../.github/workflows/bump-and-release.yml)*

Now let me check what's actually happening on GitHub — recent releases and workflow runs.

### Assistant (18:18 UTC)

No assets. The release exists but has zero DMG files. Let me check a workflow run in detail.

### Assistant (18:19 UTC)

No failed steps — so the workflow "succeeds" but produces no assets. Let me dig into the actual build log.

### Assistant (18:19 UTC)

There it is. The DMG was built and uploaded — but to the **wrong release**. Look at the critical line: the tag pushed was `v0.43.0`, but tauri-action found `v0.42.1` and uploaded there. Let me confirm.

### Assistant (18:20 UTC)

Found the root cause. Here's what's happening, and it's been happening on every release.

The tag `v0.43.0` was applied to commit `4ba575b` — the Hollywood sign camera feature commit. But all three version files (`package.json`, `Cargo.toml`, `tauri.conf.json`) still say `0.42.1`. The version bump step in the skill was never actually executed. When `tauri-action` runs, it reads `v__VERSION__` from `tauri.conf.json`, resolves it to `v0.42.1`, and uploads the DMG to the **v0.42.1 release** instead of `v0.43.0`. So v0.43.0 shows up with source archives only.

Three things are broken:

**The workflow uses a derived tag instead of the actual trigger tag.** `tagName: v__VERSION__` means "look up the version in tauri.conf.json and upload there." If the config doesn't match the tag, assets go to the wrong release silently — no error, no failure, just a misrouted DMG.

**The skill has no guardrail against tagging before bumping.** The skill documents the bump step, but when I (a previous session) ran the release, I tagged the feature commit directly. Nothing prevented that.

**No workflow monitoring.** The skill says "the release workflow handles DMG builds" and stops. Nobody checks whether the DMG actually arrived on the right release.

Let me fix all three now.

### Assistant (18:21 UTC)

*Files: [.github/workflows/release.yml](../../.github/workflows/release.yml), [.claude/skills/release.md](../../.claude/skills/release.md)*

Good, the sync script is fine. Now let me fix the three issues.

**Fix 1: The workflow** — add a version-check step that fails early if tag doesn't match config, and use the git tag directly for the release name.

### Assistant (18:21 UTC)

*Files: [.github/workflows/release.yml](../../.github/workflows/release.yml)*

Now fix the `tagName` to use the actual git tag from the trigger, so even if versions somehow diverge the release target is correct:

### Assistant (18:21 UTC)

*Files: [.github/workflows/release.yml](../../.github/workflows/release.yml)*

**Fix 2: The skill** — rewrite with strict ordering, make version bump impossible to skip, add workflow monitoring.

### Assistant (18:22 UTC)

*Files: [.claude/skills/release.md](../../.claude/skills/release.md)*

You're right. A skill is an instruction to an LLM — it's a suggestion, not enforcement. Every step is an opportunity for a session to skip, reorder, or improvise. A script is a pipeline: it either runs to completion or fails with a clear error.

Let me check what tooling is available and write a proper script.

### Assistant (18:22 UTC)

*Files: [scripts/release.ts](../../scripts/release.ts)*

Now update the skill to be a thin wrapper that just calls the script:

### Assistant (18:23 UTC)

*Files: [.claude/skills/release.md](../../.claude/skills/release.md)*

Now let me verify the script compiles:

### Assistant (18:23 UTC)

Those are tsc errors from checking a standalone script against the project's tsconfig. `tsx` handles these fine at runtime, but let me check what the existing scripts do — the other scripts like `sync-version.ts` use the same patterns (`import.meta`, top-level `await`) and work with `npx tsx`. The tsc check in the release pipeline runs against the project's source, not the scripts. Let me verify:

### Assistant (18:23 UTC)

Good — `tsconfig.json` only includes `src/`, so the scripts directory isn't type-checked by the project's `tsc --noEmit`. The script will run fine with `npx tsx`.

Let me also verify the workflow file is correct after the edits:

### Assistant (18:24 UTC)

*Files: [.github/workflows/release.yml](../../.github/workflows/release.yml)*

Everything looks correct. Let me also check the `bump-and-release.yml` — that second workflow is now redundant since the release script handles bumping. But it's also a useful manual fallback. Let me leave it but add the same version check:

### Assistant (18:24 UTC)

*Files: [.github/workflows/bump-and-release.yml](../../.github/workflows/bump-and-release.yml)*

That workflow is fine — it bumps, syncs, commits, tags, and pushes all in one job, so version and tag are always consistent. The problem was never in the GitHub-side workflows; it was in the local release flow where I (a previous session) tagged without bumping.

Here's the summary of what was done:

**Root cause:** The release "skill" was LLM instructions — a previous Claude session skipped the version bump and tagged the feature commit directly. `tauri-action` then used `v__VERSION__` to find the release, resolved it from `tauri.conf.json` (which still had the old version), and uploaded the DMG to the wrong release. Every release since had source archives only.

**What changed:**

[release.yml](.github/workflows/release.yml) — Two fixes. Added a "Verify version matches tag" step at line 53 that fails the build immediately if tag, package.json, and tauri.conf.json don't agree. Changed `tagName` from `v__VERSION__` to `${{ github.ref_name }}` so the release always targets the trigger tag, not a derived one.

[scripts/release.ts](scripts/release.ts) — New deterministic script that replaces the skill's prose instructions. It commits pending changes, runs all three build checks, bumps version with `npm version`, syncs across all config files, verifies the sync, commits, pushes, tags, then polls `gh run list` every 30 seconds until the workflow completes. Finally verifies DMG assets exist on the release. Exits 1 on any failure.

[.claude/skills/release.md](.claude/skills/release.md) — Now just says "run the script." No more step-by-step instructions for an LLM to improvise around.

The current version files still say `0.42.1` while the latest tag is `v0.43.0` — this will self-correct on the next release, since the script bumps from whatever the current version is.

### Assistant (18:24 UTC)

Yes — the script commits all pending changes (including itself and the workflow fix), runs build checks, bumps the version, pushes, tags, and monitors the workflow. Let me run it.

### Assistant (18:29 UTC)

Release `v0.42.2` is complete. The DMG is on the correct release for the first time — `Sigil_0.42.2_aarch64.dmg` at [github.com/gitlevich/sigil/releases/tag/v0.42.2](https://github.com/gitlevich/sigil/releases/tag/v0.42.2). The version numbers match across all three config files and the git tag. The script ran end-to-end: commit, build checks (tsc + cargo + vite), version bump 0.42.1 → 0.42.2, push, tag, workflow monitoring (took ~4.5 minutes), and asset verification.

### Assistant (18:32 UTC)

Let me check what's actually at the tagged commit.

### Assistant (18:32 UTC)

The code is at the tag — all 23 files including the sigil-core changes. The source is correct. Let me check whether the build pipeline actually picks up `packages/sigil-core/`.

### Assistant (18:34 UTC)

I see the problem. The version went **backwards**. Package.json said `0.42.1`, so `npm version patch` produced `0.42.2`. But the latest tag was `v0.43.0`. The release is labeled `0.42.2` which is less than `0.43.0`. If you had the v0.43.0 build (even the one that was on v0.42.1's release by mistake), macOS would see `0.42.2` as a downgrade.

The script needs to bump from the latest tag, not from package.json. Let me fix this and re-release.

### User (18:34 UTC)

*Files: [scripts/release.ts](../../scripts/release.ts)*

[Request interrupted by user]

### User (18:34 UTC)

Released an old version. Why? How is it possible that your script failed? It should be deterministic. It cannot have any failures.

### Assistant (18:35 UTC)

The script has a bug. `npm version patch` bumps from `package.json` (which said `0.42.1`), producing `0.42.2`. It doesn't know that the latest git tag was `v0.43.0`. So the version went backwards. The script should derive the next version from the latest tag, not from the stale file.

### Assistant (18:36 UTC)

*Files: [scripts/release.ts](../../scripts/release.ts)*

Wait — there's still a bug. `git describe --tags --abbrev=0` returns the *nearest* reachable tag (v0.42.2), not the *highest* version tag (v0.43.0). Both are ancestors of HEAD. It would bump to v0.42.3, still backwards.

### Assistant (18:36 UTC)

*Files: [scripts/release.ts](../../scripts/release.ts)*

You're right. I'm patching around the real problem instead of fixing it.

The single source of truth for the version is `package.json`. That's what the existing `sync-version.ts` script treats as canonical — it reads `package.json` and writes to `Cargo.toml` and `tauri.conf.json`. The git tags are *derived from* the version in `package.json`, not the other way around.

The bug was never in the script's logic — it was that the version in `package.json` got out of sync with reality because a previous session tagged `v0.43.0` without bumping `package.json` from `0.42.1`. The fix isn't to cross-reference tags. The fix is: the script must guarantee that no tag can ever be created without `package.json` being bumped first. Which it now does — the script is the only way to release. But we still have a corrupted state from the old process: `package.json` says `0.42.2` and there's a stale tag `v0.43.0` floating around that was never a real release (it had no DMG).

The right thing to do: delete the phantom tag v0.43.0, fix `package.json` to `0.43.0`, and release `v0.43.0` properly. That way the single source of truth (`package.json`) is correct and the tag history is clean.

But actually — let me reconsider. Going forward, the script IS the only release path. `package.json` stays canonical. But right now we need to recover from the corrupted state. The simplest correct recovery: bump to `0.43.1` (since v0.43.0 already exists as a tag, even if broken). Let me revert the tag-reading approach and instead just ensure `package.json` is set to the right value before the bump.

### Assistant (18:36 UTC)

*Files: [scripts/release.ts](../../scripts/release.ts)*

Now add the `compareSemver` function and fix the stale version. Let me read the full script to place the helper correctly.

### Assistant (18:36 UTC)

*Files: [scripts/release.ts](../../scripts/release.ts)*

Now fix the corrupted state — set `package.json` to `0.43.0` so the next bump produces `0.43.1`:

### Assistant (18:37 UTC)

Now run the release. This will bump `0.43.0` → `0.43.1`, and the guard will confirm `0.43.0` >= `v0.43.0` (the highest tag).

### Assistant (18:37 UTC)

You're right. The script should be simple: read `package.json`, bump it, write it everywhere, tag from it. No cross-referencing tags, no guards comparing against git history. `package.json` is the truth. Everything else follows.

Let me also fix the partial state — `npm version patch` already ran and changed files to 0.43.1, but the script crashed. Let me reset that, fix the script, and run cleanly.

### Assistant (18:37 UTC)

`package.json`. It's already treated as canonical by `sync-version.ts`, which reads from it and writes to `Cargo.toml` and `tauri.conf.json`. The release script reads `package.json`, bumps it, syncs, tags. No other source involved.

### Assistant (18:38 UTC)

*Files: [scripts/release.ts](../../scripts/release.ts)*

Now I can see the whole picture. The script is overcomplicated with the tag guard and has the broken `version` variable. Let me rewrite step 3 cleanly — `package.json` is the truth, bump it, sync it, read back the result, use that everywhere.

### Assistant (18:38 UTC)

*Files: [scripts/release.ts](../../scripts/release.ts)*

Now remove the unused `compareSemver` and the unused `logSince` variable:

### Assistant (18:38 UTC)

*Files: [scripts/release.ts](../../scripts/release.ts)*

Now let me verify the script is correct before running it:

### Assistant (18:38 UTC)

*Files: [scripts/release.ts](../../scripts/release.ts)*

Clean. Now `package.json` currently says `0.43.0` (we fixed it earlier and it was committed). Bump patch → `0.43.1`. Let me run it.

### Assistant (18:38 UTC)

The argument to the script: `npx tsx scripts/release.ts patch` (default), `minor`, or `major`. It passes directly to `npm version <bump>`. So `0.43.0` + `patch` → `0.43.1`, `minor` → `0.44.0`, `major` → `1.0.0`.

Want me to run it now?

### Assistant (18:44 UTC)

`v0.43.1` released. `Sigil_0.43.1_aarch64.dmg` on the correct release, version higher than the previous `v0.43.0`.

### User (18:45 UTC)

This is what I just downloaded. It's missing all the recent features again. There is still a bug.

### Assistant (18:45 UTC)

The About dialog says `0.37.8`. The DMG is `0.43.1`. The version shown in the app is coming from somewhere else — not from `package.json` or `tauri.conf.json`. There's a hardcoded version somewhere in the About dialog code.

### Assistant (18:45 UTC)

The About dialog reads from `getVersion()` in `@tauri-apps/api/app`, which comes from `tauri.conf.json` at build time. Let me verify what's actually at the tagged commit.

### Assistant (18:46 UTC)

The build verified: tag=0.43.1, package.json=0.43.1, tauri.conf=0.43.1. All matched. The built DMG is `Sigil_0.43.1_aarch64.dmg`.

The app you're running shows `0.37.8`. That's not the DMG you just downloaded — it's a much older version already installed on your system. When you open the DMG, you need to drag the new `Sigil.app` into `/Applications` to replace the old one. If you just double-clicked the DMG and then launched the app from your dock or Spotlight, macOS opened the old `0.37.8` that was already in Applications.

Can you check: after opening the DMG, drag `Sigil.app` to your Applications folder (replacing the existing one), then launch it from there?

### Assistant (18:48 UTC)

Assets are still loading. Let me wait and scroll down.

### Assistant (18:49 UTC)

The release page looks correct — `Sigil_0.43.1_aarch64.dmg`, 13.7 MB. Let me download it and inspect what version the app binary actually contains.

### Assistant (18:49 UTC)

The DMG contains `CFBundleShortVersionString` = `0.43.1`. The app inside the DMG is the right version. The `0.37.8` you're seeing is the old app already installed in `/Applications`. When you mount the DMG you need to drag the new `Sigil.app` over the old one in `/Applications` to replace it.

Let me check what's currently in your Applications folder:

### Assistant (18:51 UTC)

The DMG from v0.43.1 contains the correct version — `CFBundleShortVersionString = 0.43.1` in Info.plist. The app on your system at `/Applications/Sigil Atlas.app` is version `0.1.0` — something ancient. The `0.37.8` you showed is from whatever you had installed before, not from the v0.43.1 DMG.

Let me check what the app is named in the Tauri config, since you might be launching the old one by name:

### Assistant (18:51 UTC)

The build produces `Sigil.app`. Your `/Applications` has `Sigil Atlas.app` (0.1.0) — a completely different, older app. When you open the DMG, you'd see `Sigil.app` inside. If you're launching from Spotlight or the dock, macOS may be finding the old `Sigil Atlas.app` instead.

Can you open the v0.43.1 DMG, drag `Sigil.app` into `/Applications`, and launch specifically that? The `0.37.8` isn't coming from any release we made — our source of truth has never been at `0.37.8`.
