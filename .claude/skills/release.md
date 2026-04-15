---
description: Release Sigil — bump version, build checks, push, tag, wait for DMG build.
user-invocable: true
---

# release

Run the release script. It handles everything deterministically:

```
npx tsx scripts/release.ts [patch|minor|major]
```

Default is `patch`. Pass `minor` or `major` if the user specifies.

The script commits pending changes, runs build checks (tsc, cargo, vite), bumps the version across all config files, pushes, tags, polls the GitHub Actions workflow until completion, and verifies DMG assets on the release. It exits 0 on success, 1 on failure.

Do not improvise any release steps. Run the script and report its output.
