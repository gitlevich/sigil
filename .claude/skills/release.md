---
description: Build, commit, version bump, push, tag, and release Sigil — app DMGs + site.
user-invocable: true
---

# release

Full release pipeline for Sigil. Produces DMG executables via GitHub Actions and publishes the website.

## Steps

1. **Check state**: Run `git status` and `git diff --stat`. If there are no changes to commit, skip to step 5 (version bump only).

2. **Regenerate**: Run `PATH="/opt/homebrew/bin:$PATH" npx tsx scripts/generate-partner-prompt.ts` to rebuild the partner prompt from the spec.

3. **Build check**:
   - TypeScript: `node ./node_modules/.bin/tsc --noEmit`
   - Rust: `PATH="$HOME/.cargo/bin:$PATH" cargo check --manifest-path src-tauri/Cargo.toml`
   - Vite: `node ./node_modules/.bin/vite build`
   - If any fail, stop and report errors. Do not commit broken code.

4. **Stage and commit**: Stage all modified and untracked files. Include spec documents, generated files, source code. Commit with message:
   ```
   <summary of changes>

   Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
   ```
   Derive the summary from `git log` since the last version tag and `git diff --stat`.

5. **Bump version**: Read current version from `src-tauri/tauri.conf.json`. Increment patch (e.g. 0.25.7 → 0.25.8). Update both:
   - `src-tauri/tauri.conf.json` (`"version"` field)
   - `src-tauri/Cargo.toml` (`version` field under `[package]`)

   Commit: `Release X.Y.Z`

6. **Push**: `git push origin main`

7. **Tag and push tag**: `git tag -a vX.Y.Z -m "Release X.Y.Z"` then `git push origin vX.Y.Z`. This triggers the GitHub Actions release workflow which builds macOS DMGs (aarch64 + x86_64) and deploys the site to GitHub Pages.

8. **Report**: Print the tag name. The release workflow handles DMG builds and site deployment automatically.
