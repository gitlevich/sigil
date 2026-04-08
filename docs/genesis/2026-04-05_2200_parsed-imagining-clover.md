# Session: parsed-imagining-clover
**Date**: 2026-04-05 22:00 UTC  
**Source**: Claude  
**Session ID**: `b49ac34e-8f6f-4c29-8772-bf04a9e2de1c`

---

### Assistant (22:02 UTC)

The site shows stale spec text because:

1. **The spec directory was renamed** from `docs/specification/sigil-editor` to `docs/specification/sigil-editor.sigil`, but the export script still references the old path
2. **Content is bundled at build time** — `scripts/export-sigil-json.ts` generates `site/src/data/sigil-spec.json`, which Vite bakes into the JS bundle
3. **The export silently fails**, leaving the April 3 JSON snapshot in place

Let me verify the exact stale path and also check the GitHub Actions issue.

### Assistant (22:02 UTC)

Confirmed — old path doesn't exist. Now let me check the GitHub Actions workflow.

### Assistant (22:02 UTC)

*Files: [.github/workflows/release.yml](../../.github/workflows/release.yml)*

The latest run (v0.35.1) is still in progress. Let me check what's happening with it and why previous ones were cancelled.

### Assistant (22:03 UTC)

It's stuck on "Build and release" (the Tauri build step). Let me check why the previous runs were cancelled and look at the v0.32.4 run which ran for ~10 hours.

### Assistant (22:03 UTC)

There it is. Two problems:

## Findings

### 1. Site content is stale — broken export path
`scripts/export-sigil-json.ts:102` hardcodes `docs/specification/sigil-editor` but the directory was renamed to `docs/specification/sigil-editor.sigil`. The export fails with:
```
Sigil root not found: .../docs/specification/sigil-editor
```

### 2. GitHub Actions is stuck — cascading failure
The workflow has two jobs: `release` (Tauri build) and `deploy-site`. Looking at the logs:
- `deploy-site` **fails** because the export script can't find the spec directory (same path bug)
- `release` job appears to be hanging during the Tauri build step (33+ min and counting) — this is likely a long Rust compilation on the macOS runner
- Previous releases (v0.33–v0.35.0) were all **cancelled**, likely manually because they were taking too long or failing on the site deploy

The `deploy-site` job has `if: ${{ always() }}` so it runs even when `release` is cancelled — and it's been consistently failing on the export step.

### Fix

The path in the export script needs updating:

### Assistant (22:03 UTC)

*Files: [scripts/export-sigil-json.ts](../../scripts/export-sigil-json.ts)*

Also update the comment at the top:

### Assistant (22:03 UTC)

*Files: [scripts/export-sigil-json.ts](../../scripts/export-sigil-json.ts)*

Now let me verify the fix works:

### Assistant (22:04 UTC)

Export works — 85 contexts exported.

## Summary

**Root cause**: The spec directory was renamed from `sigil-editor` to `sigil-editor.sigil` but the export script path wasn't updated.

**Effects**:
1. **Stale site content** — the JSON snapshot is from April 3, before the rename
2. **GitHub Actions deploy-site job fails** — every release since the rename crashes on the export step
3. **Previous releases were cancelled** — likely because the site deploy kept failing

**Fix applied**: Updated the path in `scripts/export-sigil-json.ts` (line 7 and 102). Verified it exports 85 contexts successfully.

The currently running v0.35.1 build will still fail on deploy-site since it uses the old code. After you commit and push this fix with a new tag, both the Tauri build and site deploy should work.

### Assistant (22:04 UTC)

The Tauri build itself is also slow (33+ min) which is normal for Rust compilation on GitHub runners — that's not a bug, just the nature of the build. The cancelled runs were likely superseded by newer tag pushes.

### Assistant (22:33 UTC)

Every single build is cancelled or stuck. Let me check if any completed successfully recently and look at the one failure (v0.32.3).

### Assistant (22:33 UTC)

The current run has no log output for the build step yet — it's stuck waiting. Let me check if there's a GitHub Actions queue/concurrency issue, and look at the workflow for concurrency settings.

### Assistant (22:34 UTC)

The build step has been running since 21:30:12 — over an hour. Let me check what tauri-action@v0 does and if there's a Rust compilation issue. Let me look at the Tauri config and Cargo.toml for clues.

### Assistant (22:34 UTC)

Interesting pattern. Last successful build was April 4 ("Nested concept sigils"). After that, everything is cancelled or failed. Let me check what changed between the last success and the first failure.

### Assistant (22:34 UTC)

Found the actual build error. Let me check the current state of the code for this TS error, and also why the current run is hanging instead of failing.

### Assistant (22:34 UTC)

TypeScript compiles clean locally. The April 4 failure was a TS error that's since been fixed. The cancelled runs were superseded by newer tags. The question is why the current run (v0.35.1) is **hanging** for over an hour on the build step.

Let me check if it's actually compiling (Rust) or truly stuck:

### Assistant (22:34 UTC)

Can't get live logs. Let me check via the API if the step has any output:

### Assistant (22:34 UTC)

Started at 21:30, it's been over an hour. This is the `tauri-apps/tauri-action@v0` step. The Rust compile from scratch on a macOS runner can take 30-60 minutes (no cache), but over an hour suggests it might be stalled. However, the previous successful runs also took similar times.

Let me cancel this stuck run, commit the fix, and push a new release:

### Assistant (22:35 UTC)

Now let me check what version we're at and what needs to be committed:

### Assistant (22:35 UTC)

Wait — there are also modified spec files and the staged changes from git status at the start. Let me see the full picture:

### Assistant (22:35 UTC)

The earlier modifications from the initial git status (staged and unstaged) seem to have been committed already. Only the spec vision files and my export script fix are unstaged. But wait — the export script change isn't showing. Let me check:

### Assistant (22:35 UTC)

The export script was already fixed in commit `cb1d131`. My edit was a no-op since the linter reformatted already had the fix. Good.

Now the real question: why are builds hanging? Let me look at a successful run's timing vs the current hanging ones:

### Assistant (22:35 UTC)

The last successful build took only ~5.5 minutes for "Build and release." The current one has been running for over an hour. Something changed.

Let me check if Cargo.lock or dependencies changed significantly between the last success and current:

### Assistant (22:35 UTC)

We're on `refactor/spec-aligned-types`, not `main`. Understood — I won't commit or push from here.

Let me focus on diagnosing why the build hangs. The Cargo changes are minimal (version bump). Let me check if the Rust code compiles at all:

### Assistant (22:36 UTC)

The export fix is on this branch but **not on `main`**. The `main` branch (which is what the release workflow builds from) still has the broken path.

Now let me check why the build step is hanging. Let me look at the TypeScript compilation on `main`:

### Assistant (22:36 UTC)

`main` compiles clean with `tsc`. So the TS error from April 4 is fixed. Then why is the build hanging?

The issue is likely the `tauri-apps/tauri-action@v0` itself. Version `v0` is a moving target. Let me check what version the successful runs used vs now:

### Assistant (22:36 UTC)

Let me check if the macOS runner has a Rust cache issue. The successful run (April 4 ~07:18) built in 5 min, but the current one hangs. Key difference: the successful run was the ONLY run at the time, but since April 4 there have been 10+ rapid-fire tag pushes. Each one triggers a new run that likely gets queued/stalled, and with no concurrency controls they pile up.

Actually — let me look at this from a different angle. Let me check if there are **multiple concurrent runs** trying to use the same runner:

### Assistant (22:36 UTC)

Good, the cancel went through. No runs in progress. Here's my diagnosis:

## Root cause of stalling builds

The build step (`tauri-apps/tauri-action@v0`) is hanging, not failing. The last successful release was April 4 at v0.28.0. Since then:

1. **No Rust compilation cache** — `tauri-action@v0` doesn't cache Rust compilation by default. Each run compiles the entire Rust toolchain + all crates from scratch on macOS. Without cache, this takes 30-60+ minutes.

2. **Rapid tag pushes** — you pushed ~10 tags on April 5 alone. Each tag triggers a new workflow run. GitHub's free-tier macOS runners are limited, and runs likely queued behind each other or timed out.

3. **No concurrency control** — the workflow has no `concurrency` setting, so old runs don't get auto-cancelled when new tags are pushed.

The fix is on your `refactor/spec-aligned-types` branch (export path + other changes) but not on `main`. To deploy:

1. You need to merge the export path fix to `main`  
2. Add Rust caching to the workflow to speed up builds
3. Add concurrency control to auto-cancel superseded runs

Want me to prepare these workflow improvements on a branch you can merge? Or would you prefer to cherry-pick just the export fix to `main` and push a new tag?

### Assistant (22:54 UTC)

Now let me fix the export script path and improve the workflow:

### Assistant (22:54 UTC)

*Files: [.claude/worktrees/fix-ci/scripts/export-sigil-json.ts](../../.claude/worktrees/fix-ci/scripts/export-sigil-json.ts), [.claude/worktrees/fix-ci/.github/workflows/release.yml](../../.claude/worktrees/fix-ci/.github/workflows/release.yml)*

Now fix the workflow — add Rust caching, concurrency control, and a build timeout:

### Assistant (22:54 UTC)

*Files: [.claude/worktrees/fix-ci/.github/workflows/release.yml](../../.claude/worktrees/fix-ci/.github/workflows/release.yml)*

Now verify the export works:

### Assistant (22:54 UTC)

Now commit and push. Let me check what version to tag:

### Assistant (22:54 UTC)

v0.35.1 tag already exists. I need to bump to 0.35.2.

### Assistant (22:55 UTC)

*Files: [.claude/worktrees/fix-ci/src-tauri/tauri.conf.json](../../.claude/worktrees/fix-ci/src-tauri/tauri.conf.json), [.claude/worktrees/fix-ci/src-tauri/Cargo.toml](../../.claude/worktrees/fix-ci/src-tauri/Cargo.toml)*

Pushed. Let me verify the workflow kicked off:

### Assistant (22:55 UTC)

v0.35.2 is running. Now let me exit the worktree.

### Assistant (22:55 UTC)

The commit is already pushed to `main`, so the worktree copy is safe to discard.

### Assistant (22:55 UTC)

Done. v0.35.2 is running now with these fixes:

1. **Export path** — updated to `sigil-editor.sigil` (fixes site deploy)
2. **Rust cache** — `Swatinem/rust-cache@v2` for the `src-tauri` workspace (should cut build from 30-60 min to ~5 min on cache hit)
3. **Concurrency control** — new tag pushes auto-cancel previous runs
4. **Timeouts** — 60 min for release, 10 min for site deploy (prevents infinite hangs)
5. **Fresh spec JSON** — 85 contexts exported and committed

Your `refactor/spec-aligned-types` branch is untouched.

### Assistant (22:55 UTC)

The build is in progress — you can track it at the GitHub Actions page for run 24012326287.

### Assistant (22:58 UTC)

You can't build a macOS Tauri app in Docker — Apple codesigning and notarization require a macOS runner. There's no way around that for the `.dmg` build.

But the site deploy (which is the stale content problem) runs on Ubuntu and **can** be decoupled. Let me check the current run status and see what's actually slow.

### Assistant (22:58 UTC)

The release job got cancelled again (concurrency kicked in?), and the **Export spec JSON step SUCCEEDED** (the path fix works), but the **site build failed**. Let me see why:

### Assistant (22:58 UTC)

The export worked, but the site has a TypeScript error in `MarkdownPreview.tsx`. Let me fix it.

### Assistant (22:58 UTC)

*Files: [.claude/worktrees/fix-ci-2/site/src/viewer/MarkdownPreview.tsx](../../.claude/worktrees/fix-ci-2/site/src/viewer/MarkdownPreview.tsx)*

The issue is the `img` component's parameter type `Record<string, unknown>` isn't compatible with the expected props type. Quick fix:

### Assistant (22:58 UTC)

*Files: [.claude/worktrees/fix-ci-2/site/src/viewer/MarkdownPreview.tsx](../../.claude/worktrees/fix-ci-2/site/src/viewer/MarkdownPreview.tsx)*

Also need to fix the spread — `width` is already the right type now:

### Assistant (22:59 UTC)

*Files: [.claude/worktrees/fix-ci-2/site/src/viewer/MarkdownPreview.tsx](../../.claude/worktrees/fix-ci-2/site/src/viewer/MarkdownPreview.tsx)*

Verify it compiles:

### Assistant (22:59 UTC)

Understood — stopping. The site has way more TS errors than just the img component. The `Sigil` type in `site/src/viewer/types.ts` is out of sync with the new JSON structure (it expects `root` and `domain_language` but the export now produces a flat context with `language`).

This isn't a quick fix — it's a type/schema migration across the entire site viewer. Let me exit the worktree and we can discuss approach.

### Assistant (22:59 UTC)

Here's the real picture:

The site viewer's `Sigil` type expects the **old** JSON shape (`root`, `domain_language`), but the export script was updated (on the refactor branch, now merged) to produce a **new** shape (flat context with `language`). There are ~25 TS errors across Atlas, Breadcrumb, TreeView, SigilViewer, MobileViewer, and ViewerState.

This is a schema migration of the site viewer — not a one-line fix. How do you want to handle it? Options:

1. **Revert the export script** to produce the old shape so the site deploys now, migrate later
2. **Update the site viewer types and components** to match the new schema (proper fix, but touches ~7 files)
3. **Skip `tsc` in the site build** temporarily (hack, not recommended)

### Assistant (22:59 UTC)

Waiting for your call on which approach to take.

### Assistant (22:59 UTC)

From your refactor branch. Commit `cb1d131` ("Rename domain_language→language in site viewer and export script") changed the export script's output shape — renaming `domain_language` to `language` and flattening the `root` wrapper — but it only updated the export script and some site files. The site viewer's `types.ts` and several components still expect the old shape (`Sigil.root`, `domain_language`).

That commit was on `refactor/spec-aligned-types`. When I created the CI fix worktree, I merged the export path fix to `main` — but `main` still has the **old** site viewer types. So now `main` has an export script that produces the new shape, but site components that expect the old shape.

The simplest fix: revert the export script on `main` to produce the old JSON shape (keep `domain_language` and the `root` wrapper), so the site deploys immediately. Your refactor branch can land the full migration (export + viewer types) together when it's ready.

Want me to do that?

### Assistant (23:00 UTC)

Let me understand what the site viewer expects vs what the export now produces:

### Assistant (23:00 UTC)

*Files: [.claude/worktrees/fix-ci-3/site/src/viewer/types.ts](../../.claude/worktrees/fix-ci-3/site/src/viewer/types.ts), [.claude/worktrees/fix-ci-3/scripts/export-sigil-json.ts](../../.claude/worktrees/fix-ci-3/scripts/export-sigil-json.ts)*

OK — the export script on `main` still uses `domain_language` and the `root` wrapper. The types come from `sigil-core`. Let me check what `sigil-core` exports:

### Assistant (23:00 UTC)

*Files: [.claude/worktrees/fix-ci-3/packages/sigil-core/src/types.ts](../../.claude/worktrees/fix-ci-3/packages/sigil-core/src/types.ts)*

So `sigil-core` on `main` still has the old shape (`root`, `domain_language`), and the export script produces exactly that. The site viewer re-exports from `sigil-core`. This should all be consistent on `main`.

Let me actually run the site build to see what happens:

### Assistant (23:00 UTC)

Wait — the `sigil-core` types.ts I just read has `root` and `domain_language`. But the errors say `root` doesn't exist on `Sigil`. That means `tsc -b` is resolving a **different** version of sigil-core. Let me check:

### Assistant (23:00 UTC)

No project references to sigil-core. Let me check how the import resolves:

### Assistant (23:01 UTC)

So site resolves `sigil-core` from `packages/sigil-core/src/types.ts` which has `root` and `domain_language`. But the build errors say these don't exist. Something is cached or the worktree resolved differently. Let me try again:

### Assistant (23:01 UTC)

After `npm install`, the `root`/`domain_language` errors are gone. Only the `MarkdownPreview.tsx` `img` component type error remains. On CI, `npm install` runs in the site directory separately — but it's a workspace, so it should resolve the same way. Let me check if CI installs at root level first:

Looking at the workflow — the deploy-site job runs `npm install` at root, then `npm install` again in `site/`. The root install should hoist `sigil-core`. But on the CI run that failed, it **did** show the `root` errors — meaning CI resolved a different `sigil-core`. Likely the `packages/sigil-core` wasn't linked properly on CI.

Actually wait — the CI log showed `tsc -b` which uses project references. The `tsconfig.json` has no reference to `sigil-core`, so `tsc -b` might resolve it differently than `tsc`. Let me just focus on fixing the one remaining error and testing it matches CI:

### Assistant (23:01 UTC)

Locally it's just the one `MarkdownPreview` error. The CI showed more errors because the workspace linking didn't work in the CI environment. Let me fix both issues:

1. Fix the MarkdownPreview type error
2. Ensure CI resolves sigil-core properly (the root `npm install` should handle workspace linking, then the site `npm install` is redundant)

### Assistant (23:01 UTC)

*Files: [.claude/worktrees/fix-ci-3/site/src/viewer/MarkdownPreview.tsx](../../.claude/worktrees/fix-ci-3/site/src/viewer/MarkdownPreview.tsx)*

The `Record<string, unknown>` parameter types are incompatible with react-markdown's expected component props. Fix all three component overrides:

### Assistant (23:02 UTC)

*Files: [.claude/worktrees/fix-ci-3/site/src/viewer/MarkdownPreview.tsx](../../.claude/worktrees/fix-ci-3/site/src/viewer/MarkdownPreview.tsx)*

Now fix the CI workspace issue. The `deploy-site` job needs to install at the repo root so npm workspaces link `sigil-core`:

### Assistant (23:02 UTC)

*Files: [.claude/worktrees/fix-ci-3/.github/workflows/release.yml](../../.claude/worktrees/fix-ci-3/.github/workflows/release.yml)*

The root `npm install` should already set up workspaces. But the site build step also does `npm install` inside `site/`:

### Assistant (23:02 UTC)

*Files: [.claude/worktrees/fix-ci-3/.github/workflows/release.yml](../../.claude/worktrees/fix-ci-3/.github/workflows/release.yml)*

The redundant `npm install` in `site/` could break workspace linking. Remove it — root install already handles it:

### Assistant (23:02 UTC)

*Files: [.claude/worktrees/fix-ci-3/.github/workflows/release.yml](../../.claude/worktrees/fix-ci-3/.github/workflows/release.yml)*

Now verify:

### Assistant (23:02 UTC)

Clean. Now do a full site build:

### Assistant (23:02 UTC)

Full build passes. Now bump version, commit, tag, push:

### Assistant (23:02 UTC)

v0.35.2 already exists from the previous push. Let me bump from 0.35.2:

### Assistant (23:03 UTC)

v0.35.3 is running and v0.35.2 was auto-cancelled by the concurrency control.

### Assistant (23:03 UTC)

v0.35.3 is running. Three fixes in this push:
1. **MarkdownPreview types** — removed explicit `Record<string, unknown>` params, let TS infer from react-markdown
2. **Removed redundant `npm install`** in site build step that broke workspace linking of `sigil-core`
3. **Concurrency control** auto-cancelled the stale v0.35.2 run

The Rust cache from v0.35.2 should warm things up for this build too. Your refactor branch is untouched.

### Assistant (23:03 UTC)

The build is in progress — run 24012444341. Want me to check on it in a few minutes?

### Assistant (23:37 UTC)

Both jobs succeeded. The release built, and the site deployed with fresh spec content.

### Assistant (23:40 UTC)

You have uncommitted changes on `refactor/spec-aligned-types` — spec files being moved around (Vision moved from under Application to top level, new invariants added). 

Do you want to commit these first before merging to main, or stash them?

### Assistant (23:41 UTC)

Now merge to main:

### Assistant (23:41 UTC)

Conflict in the generated JSON file. Just regenerate it:

### Assistant (23:41 UTC)

Merged. Want me to push and tag a new release?

### Assistant (23:45 UTC)

Yes — commit `cbbed99` on `refactor/spec-aligned-types` includes all the spec changes:

- Vision moved from `Application/Vision/` to top-level `Vision/`
- 3 new Application invariants (state-restored-to-saved, state-saved-on-exit, vision-tab-opened-on-first-run)
- Updated `language.md` and `vision.md`

All now merged into `main` via `167b62e`.

### Assistant (23:45 UTC)

Need to bump to 0.36.0 since this is a feature merge (spec restructure + type renames).

### Assistant (23:45 UTC)

v0.36.0 pushed. Watching the build now.

### Assistant (23:47 UTC)

All setup steps passed quickly (cache hit on Rust deps). Now in the "Build and release" step. Let me check again in a few minutes.

### Assistant (23:50 UTC)

Still building the Tauri app (Rust compilation). This is expected — even with cache, a version bump touches Cargo.toml which invalidates parts of the build. Let me check again.

### Assistant (23:56 UTC)

~8 minutes in, still compiling. v0.35.3 took about 7 minutes total. The merge brought in new Rust code (type renames in commands), so more recompilation this time.

### Assistant (00:00 UTC)

~12 minutes. Let me check if the TS/frontend build passed and it's in Rust compilation or code signing:

### Assistant (00:06 UTC)

~17 minutes now. This is longer than v0.35.3 (which was ~7 min). The merge brought significant Rust changes (type renames across commands, models, exports). Let me keep watching.

### Assistant (00:11 UTC)

~22 minutes. This is taking a while — the merge brought in a lot of Rust changes that likely invalidated most of the cache. Still within the 60-minute timeout though.

### Assistant (00:21 UTC)

32 minutes. Getting close to the timeout. Let me check if it's actually progressing or stuck:

### Assistant (00:21 UTC)

Started at 23:46, it's been ~32 min. This is concerning — v0.35.3 built in under 7 min total. The merge included Rust source changes that the cache can't help with. But 32 min for Rust compile of a Tauri app on macOS runner isn't abnormal for a cold-ish compile.

### Assistant (00:31 UTC)

Release was cancelled and deploy-site failed. Let me check what happened:

### Assistant (00:31 UTC)

Same `root` doesn't exist on `Sigil` errors. The merge brought the refactored `sigil-core` types (where `Sigil` is now a flat `Context` without `root` wrapper), but the site viewer components still reference `sigil.root`. This worked locally because npm workspace linking resolved properly, but on CI it's picking up the new types.

The site viewer components need to be updated to match the new `Sigil` type. Let me fix this properly.

### Assistant (00:31 UTC)

*Files: [packages/sigil-core/src/types.ts](../../packages/sigil-core/src/types.ts)*

OK — now `Sigil` IS the recursive unit (no `root`, no `vision`, uses `language` not `domain_language`). But the export script still produces `{name, vision, root}`. And the site viewer expects `root`. Both need to align with the new type.

Let me check the export script as it is now on main after the merge:

### Assistant (00:32 UTC)

*Files: [scripts/export-sigil-json.ts](../../scripts/export-sigil-json.ts)*

The export script's local `Sigil` interface still has `root` and `vision`. It needs to produce the flat `Sigil` shape. And the site viewer needs to stop referencing `.root` and `.vision`.

Let me fix the export script first, then update all site viewer components.

### Assistant (00:32 UTC)

Now I need to understand the new shape. The `Sigil` is now the root context itself — it has `language`, `children`, `affordances`, `invariants`. Vision is read from `vision.md` but where does it go? Let me check:

### Assistant (00:32 UTC)

*Files: [scripts/export-sigil-json.ts](../../scripts/export-sigil-json.ts)*

Now let me check how the site references VisionPanel and what it expects:

### Assistant (00:32 UTC)

OK, the plan is clear. The new `Sigil` is flat — it IS the root context. Vision needs to be stored somewhere. Looking at the directory structure, there's a `Vision/` child context now. So vision is just a child of the sigil, not a separate field.

But the export script still reads `vision.md` separately. I need to decide: should the export produce the new flat `Sigil` type (matching `sigil-core`), or should the site keep its own types?

The cleanest approach: make the export produce the `sigil-core` `Sigil` shape (flat, no `root` wrapper), and update the site viewer to match.

### Assistant (00:32 UTC)

*Files: [site/src/viewer/SigilViewer.tsx](../../site/src/viewer/SigilViewer.tsx)*

Now let me do all the fixes. First, update the export script to produce the flat shape:

### Assistant (00:32 UTC)

*Files: [scripts/export-sigil-json.ts](../../scripts/export-sigil-json.ts)*

Now remove the `Context` interface since it's the same as `Sigil`:

### Assistant (00:32 UTC)

*Files: [scripts/export-sigil-json.ts](../../scripts/export-sigil-json.ts)*

Now update `readContext` to return `Sigil`:

### Assistant (00:33 UTC)

*Files: [scripts/export-sigil-json.ts](../../scripts/export-sigil-json.ts)*

Wait, that might have replaced "Context" in the comment too. Let me check:

### Assistant (00:33 UTC)

*Files: [scripts/export-sigil-json.ts](../../scripts/export-sigil-json.ts)*

Clean. `readContext` became `readSigil`, `isContextDir` became `isSigilDir`. Now update the site viewer. The key change: everywhere that says `sigil.root` should just be `sigil`, and `sigil.vision` needs to find the Vision child context.

### Assistant (00:33 UTC)

*Files: [site/src/viewer/SigilViewer.tsx](../../site/src/viewer/SigilViewer.tsx)*

Now I need to read the files I'll edit to understand the full picture, then make all changes:

### Assistant (00:33 UTC)

*Files: [site/src/viewer/ViewerState.tsx](../../site/src/viewer/ViewerState.tsx), [site/src/viewer/TreeView.tsx](../../site/src/viewer/TreeView.tsx), [site/src/viewer/Atlas.tsx](../../site/src/viewer/Atlas.tsx), [site/src/viewer/Breadcrumb.tsx](../../site/src/viewer/Breadcrumb.tsx), [site/src/viewer/MobileViewer.tsx](../../site/src/viewer/MobileViewer.tsx)*

Now I have the full picture. The sigil IS the root — `sigil.root` → `sigil`, and `sigil.vision` → find the Vision child's language. Let me also check what utils expect:

### Assistant (00:33 UTC)

*Files: [site/src/viewer/utils.ts](../../site/src/viewer/utils.ts)*

Good — utils come from `sigil-core`. These functions already take a `Sigil` (which is the root context). So `findContext(sigil, currentPath)` should work — I just need to drop the `.root`. Let me check the sigil-core function signatures:

### Assistant (00:34 UTC)

All take `Sigil` as first arg. Now make all the edits. The pattern is simple: `sigil.root` → `sigil` everywhere, and handle `sigil.vision` specially.

### Assistant (00:34 UTC)

*Files: [site/src/viewer/SigilViewer.tsx](../../site/src/viewer/SigilViewer.tsx)*

Now fix the vision reference. Vision is now a child context named "Vision":

### Assistant (00:34 UTC)

*Files: [site/src/viewer/SigilViewer.tsx](../../site/src/viewer/SigilViewer.tsx), [site/src/viewer/ViewerState.tsx](../../site/src/viewer/ViewerState.tsx), [site/src/viewer/TreeView.tsx](../../site/src/viewer/TreeView.tsx), [site/src/viewer/Atlas.tsx](../../site/src/viewer/Atlas.tsx), [site/src/viewer/Breadcrumb.tsx](../../site/src/viewer/Breadcrumb.tsx), [site/src/viewer/MobileViewer.tsx](../../site/src/viewer/MobileViewer.tsx)*

Now remove the `Context` import in files that import it (they should use `Sigil`):

### Assistant (00:34 UTC)

*Files: [site/src/viewer/Atlas.tsx](../../site/src/viewer/Atlas.tsx), [site/src/viewer/TreeView.tsx](../../site/src/viewer/TreeView.tsx)*

Now update the types.ts — remove Context export if it's not used elsewhere:

### Assistant (00:34 UTC)

The types.ts still exports `Context` as an alias. Since nothing imports `Context` from types anymore, let me clean it up:

### Assistant (00:34 UTC)

*Files: [site/src/viewer/types.ts](../../site/src/viewer/types.ts)*

There's the problem. The site had its OWN `Sigil` interface (with `vision` and `root`), shadowing `sigil-core`'s `Sigil`. Now that the shapes should match, just re-export from sigil-core:

### Assistant (00:34 UTC)

*Files: [site/src/viewer/types.ts](../../site/src/viewer/types.ts)*

Now verify:

### Assistant (00:35 UTC)

*Files: [site/src/viewer/SubContextBar.tsx](../../site/src/viewer/SubContextBar.tsx)*

Clean. Full build:

### Assistant (00:35 UTC)

Also verify the main app still compiles:

### Assistant (00:35 UTC)

Everything compiles. Now commit, bump version, tag, and push:

### Assistant (00:36 UTC)

v0.36.1 is running. The concurrency control should have cancelled v0.36.0 (which was still building). The site deploy job should pass this time since all types are aligned.

### Assistant (00:36 UTC)

Want me to keep watching this build?
