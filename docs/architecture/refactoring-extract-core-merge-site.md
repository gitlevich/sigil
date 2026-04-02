You are refactoring the Sigil project. There are currently two separate repos:

- **App**: `/Users/vlad/Attention Lab/sigil-specs/sigil/` — a Tauri 2 desktop app (Rust + React/TypeScript). GitHub: `gitlevich/sigil`
- **Site**: `/Users/vlad/Attention Lab/sigil-specs/sigil-engineering-site/` — a Vite + React site deployed to GitHub Pages at sigilengineering.com. GitHub: `gitlevich/sigil-engineering-site`

The site is a read-only viewer for the app's spec. Currently the spec is exported from the app via `npx tsx scripts/export-sigil-json.ts` which writes `sigil-spec.json` into the site's `src/data/` folder. This requires a manual export, separate commit, separate push. The two codebases share significant duplicated logic that has already diverged.

## Goal

1. Move the site into the app repo as `site/`
2. Extract shared TypeScript logic into `packages/sigil-core/`
3. Set up CI so every release tag deploys both the app and the site

## Step 1: Move the site into this repo

Move the contents of `sigil-engineering-site/` into `sigil/site/`. You can use `git subtree add` to preserve history, or a plain copy if that's simpler.

Update `scripts/export-sigil-json.ts` — change the default output path from `../sigil-engineering-site/src/data/sigil-spec.json` to `site/src/data/sigil-spec.json`.

Verify: `npx tsx scripts/export-sigil-json.ts` writes to `site/src/data/sigil-spec.json`. `cd site && npm install && npm run build` succeeds.

## Step 2: Create sigil-core as a workspace package

Create `packages/sigil-core/` with its own `package.json` (name: `sigil-core`) and `tsconfig.json`. No React dependency. Pure TypeScript, compiled to ESM.

Set up npm workspaces in the root `package.json`:
```json
"workspaces": ["packages/*", "site"]
```

Both `site/package.json` and the root `package.json` add `"sigil-core": "workspace:*"` as a dependency.

## Step 3: Extract shared code into sigil-core

**Types** (`packages/sigil-core/src/types.ts`):
- `Affordance`, `Invariant`, `Context` (without `path` field — that's Tauri-specific), `Sigil`
- The Tauri app extends: `interface TauriContext extends Context { path: string }`

**Tree utilities** (`packages/sigil-core/src/tree.ts`):
- `findContext`, `buildBreadcrumb`, `flattenPaths`, `buildPath`, `makeSummary`
- Take from either codebase — they're identical

**Ref resolution** (`packages/sigil-core/src/refs.ts`):
- `resolveRefName` (with plural + verb tense stripping for `-s`, `-ies`, `-ed`, `-ing`) — canonical version is in `src/components/Editor/MarkdownEditor.tsx`
- `buildLexicalScope`, `flattenOntologyRefs` — merge the two versions. The site's (`site/src/viewer/utils.ts`) handles `#` and `!` prefixes with ancestor walking. The app's (`src/components/Editor/EditorShell.tsx`) handles `@` refs and ontology flattening. The merged version should handle all three prefix types, walk ancestors for affordances/invariants, include ontology names themselves (not just their children), and use `resolveRefName` for fuzzy matching everywhere.
- `findAffordance` — from the app's `MarkdownEditor.tsx`, includes fuzzy matching via `resolveRefName`
- `findInvariantInScope`, `findAffordanceInScope` — from the app, walk ancestors and return `ownerPath`
- `Ref` type (from `site/src/viewer/utils.ts` — has `prefix`, `navigable`, `navigateTo`)
- Helper functions: `flattenName`, `fromDashForm`, `buildNameIndex`

**Frontmatter** (`packages/sigil-core/src/frontmatter.ts`):
- `stripFrontmatter` — duplicated in both MarkdownPreview components, extract once

Export everything from `packages/sigil-core/src/index.ts`.

## Step 4: Replace inline code with imports

**Tauri app** (`src/components/Editor/`):
- `MarkdownEditor.tsx` — import `resolveRefName`, `findAffordance`, `findInvariantInScope`, `findAffordanceInScope`, `fromDashForm`, `flattenName`, `buildNameIndex`, types from `sigil-core`. Keep CodeMirror-specific decoration, highlighting, and click handling in place.
- `EditorShell.tsx` — import `buildLexicalScope`, `flattenOntologyRefs`, `findContext`, `buildBreadcrumb`, `SiblingInfo`/`Ref` type from `sigil-core`. Keep React state management and dispatch in place.

**Site** (`site/src/viewer/`):
- `utils.ts` — replace with re-exports from `sigil-core`. Delete all duplicated functions.
- `types.ts` — re-export from `sigil-core`
- `MarkdownPreview.tsx` — remove the inflection regex generation (the `inflected` array and expanded pattern). Instead, use `resolveRefName` from `sigil-core` for the lookup. Build the regex pattern from exact ref names (as before the inflection was added). In the lookup, when a match isn't found by exact key, try `resolveRefName(matchedName, refs.map(r => r.name))` to resolve inflected forms. Keep the React rendering (ReactMarkdown, portals, RefSpan) in place.

## Step 5: Update CI — deploy site on every release

Add a `deploy-site` job to `.github/workflows/release.yml`:

```yaml
  deploy-site:
    runs-on: ubuntu-latest
    needs: release
    permissions:
      contents: write
      pages: write
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: lts/*

      - name: Install dependencies
        run: npm install

      - name: Export spec JSON
        run: npx tsx scripts/export-sigil-json.ts

      - name: Build site
        working-directory: site
        run: |
          npm install
          npm run build

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: site/dist
          cname: sigilengineering.com
```

This runs after the app release succeeds. Configure GitHub Pages for the `sigil` repo to serve from the `gh-pages` branch. The `cname` field preserves the custom domain.

## Step 6: Archive the old site repo

After verifying the site deploys correctly from this repo, archive `gitlevich/sigil-engineering-site` on GitHub. Update DNS if needed (it shouldn't need changes — same GitHub Pages IPs, same CNAME).

## What NOT to extract into sigil-core

- React components. The app uses CodeMirror; the site uses react-markdown. Different renderers, different interaction models. Don't force shared React.
- CSS/styling. Each has its own design.
- The partner prompt build script (`scripts/generate-partner-prompt.ts`) — stays at the app level, reads the spec directly.
- Tauri-specific code (Rust backend, IPC, filesystem operations).
- The spec export script (`scripts/export-sigil-json.ts`) — stays at the app level, writes to `site/src/data/`.

## Verification

After the full refactoring:
- `npm run build` from repo root builds the Tauri app
- `cd site && npm run build` builds the website
- `npx tsx scripts/export-sigil-json.ts` writes to `site/src/data/`
- Both resolve `@AttentionLanguage`, `@Collapse`, `#persists`, `!full-context` identically
- Verb tense resolution works in both (`@collapsed` → `Collapse`, `@collapsing` → `Collapse`)
- Ancestor invariant/affordance scope works in both
- `git push --tags` triggers app release AND site deployment
- sigilengineering.com serves the updated spec viewer
