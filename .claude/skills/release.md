---
description: Commit all changes, bump version, push, and create a GitHub release with changelog.
user-invocable: true
---

# release

Commit, push, and release a new version of Sigil.

## Steps

1. **Check state**: Run `git status -s` and `git diff --stat`. If there are no changes, abort with "Nothing to release."

2. **Determine version**: Read the current version from `src-tauri/tauri.conf.json`. Bump the patch number by default (e.g. 0.14.0 → 0.14.1). If the user specifies a version, use that instead.

3. **Update version files**: Set the new version in both:
   - `src-tauri/tauri.conf.json` (`"version"` field)
   - `src-tauri/Cargo.toml` (`version` field under `[package]`)

4. **Build check**: Run `npx tsc --noEmit` and `cd src-tauri && cargo check`. If either fails, stop and report the errors. Do not commit broken code.

5. **Stage and commit**: Stage all modified and untracked files relevant to the changes (review `git status` — skip docs/specification changes unless they are part of the feature work). Commit with message:

   ```
   Bump version to X.Y.Z

   - bullet summary of changes since last release

   Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
   ```

   Derive the bullet summary from `git diff` and `git log` since the last version tag.

6. **Push**: `git push`

7. **Create release**: Use `gh release create vX.Y.Z --title "vX.Y.Z" --notes "<changelog>"`. The changelog should list the user-visible changes as concise bullets (same as the commit body).

8. **Report**: Print the release URL.
