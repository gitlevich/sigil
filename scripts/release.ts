/**
 * Deterministic release pipeline for Sigil.
 *
 * Usage: npx tsx scripts/release.ts [patch|minor|major]
 *
 * 1. Commits any staged/unstaged changes
 * 2. Runs build checks (tsc, cargo check, vite build)
 * 3. Bumps version in package.json, syncs to Cargo.toml + tauri.conf.json
 * 4. Commits the version bump
 * 5. Pushes to main
 * 6. Tags and pushes the tag (triggers GitHub Actions)
 * 7. Polls the workflow until it completes
 * 8. Verifies DMG assets on the release
 * 9. Exits 0 on success, 1 on failure
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bump = (process.argv[2] ?? "patch") as "patch" | "minor" | "major";

if (!["patch", "minor", "major"].includes(bump)) {
  console.error(`Usage: npx tsx scripts/release.ts [patch|minor|major]`);
  process.exit(1);
}

function run(cmd: string, opts?: { cwd?: string; silent?: boolean }): string {
  const cwd = opts?.cwd ?? root;
  if (!opts?.silent) console.log(`> ${cmd}`);
  return execSync(cmd, { cwd, encoding: "utf-8", stdio: opts?.silent ? "pipe" : "inherit" }) ?? "";
}

function runCapture(cmd: string): string {
  return execSync(cmd, { cwd: root, encoding: "utf-8" }).trim();
}

function fail(msg: string): never {
  console.error(`\nRELEASE FAILED: ${msg}`);
  process.exit(1);
}

// ── Step 1: Commit pending changes ──────────────────────────────────

console.log("\n=== Step 1: Checking working tree ===\n");

const status = runCapture("git status --porcelain");
if (status) {
  console.log("Uncommitted changes found, committing...\n");

  // Regenerate partner prompt before committing
  run('PATH="/opt/homebrew/bin:$PATH" npx tsx scripts/generate-partner-prompt.ts');

  // Build the commit message from recent changes
  const lastTag = runCapture("git describe --tags --abbrev=0 2>/dev/null || echo ''");
  const diffStat = runCapture("git diff --stat HEAD");
  // Stage everything
  run("git add -A");

  const commitMsg = `release: stage changes since ${lastTag || "start"}\n\n${diffStat}\n\nCo-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`;
  execSync(`git commit -m ${JSON.stringify(commitMsg)}`, { cwd: root, stdio: "inherit" });
} else {
  console.log("Working tree clean.\n");
}

// ── Step 2: Build checks ────────────────────────────────────────────

console.log("\n=== Step 2: Build checks ===\n");

try {
  run("node ./node_modules/.bin/tsc --noEmit");
} catch {
  fail("TypeScript compilation failed");
}

try {
  run('PATH="$HOME/.cargo/bin:$PATH" cargo check --manifest-path src-tauri/Cargo.toml');
} catch {
  fail("Rust cargo check failed");
}

try {
  run("node ./node_modules/.bin/vite build");
} catch {
  fail("Vite build failed");
}

// ── Step 3: Bump version ────────────────────────────────────────────
//
// package.json is the single source of truth.
// Bump it, sync to Cargo.toml and tauri.conf.json, verify, commit.

console.log(`\n=== Step 3: Bumping version (${bump}) ===\n`);

run(`npm version ${bump} --no-git-tag-version`);
run("npx tsx scripts/sync-version.ts");

// Read back the version from the source of truth
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8")).version;

// Verify sync wrote correctly
const tauriVersion = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf-8")).version;
const cargoVersion = readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf-8").match(/^version = "(.+)"/m)?.[1];

if (tauriVersion !== version) fail(`tauri.conf.json has ${tauriVersion}, expected ${version}`);
if (cargoVersion !== version) fail(`Cargo.toml has ${cargoVersion}, expected ${version}`);

console.log(`Version: ${version} (package.json -> Cargo.toml, tauri.conf.json)\n`);

// Commit the bump
run("git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/tauri.conf.json");
execSync(
  `git commit -m "release: v${version}\n\nCo-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"`,
  { cwd: root, stdio: "inherit" }
);

// ── Step 4: Push ────────────────────────────────────────────────────

console.log("\n=== Step 4: Pushing to main ===\n");
run("git push origin main");

// ── Step 5: Tag ─────────────────────────────────────────────────────

const tag = `v${version}`;
console.log(`\n=== Step 5: Tagging ${tag} ===\n`);

run(`git tag -a ${tag} -m "Release ${version}"`);
run(`git push origin ${tag}`);

// ── Step 6: Monitor workflow ────────────────────────────────────────

console.log("\n=== Step 6: Waiting for GitHub Actions workflow ===\n");

// Give GitHub a moment to pick up the tag push
await sleep(5000);

const maxWait = 15 * 60 * 1000; // 15 minutes
const pollInterval = 30 * 1000; // 30 seconds
const start = Date.now();

let conclusion = "";
let runId = "";

while (Date.now() - start < maxWait) {
  const runsJson = runCapture(
    `gh run list --workflow=release.yml --limit 1 --json status,conclusion,databaseId,headBranch,event`
  );
  const runs = JSON.parse(runsJson);
  if (runs.length === 0) {
    console.log("No workflow run found yet, waiting...");
    await sleep(pollInterval);
    continue;
  }

  const latest = runs[0];
  runId = latest.databaseId;

  if (latest.status === "completed") {
    conclusion = latest.conclusion;
    break;
  }

  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(`Workflow ${runId} status: ${latest.status} (${elapsed}s elapsed)`);
  await sleep(pollInterval);
}

if (!conclusion) {
  fail(`Workflow timed out after ${maxWait / 60000} minutes. Check https://github.com/gitlevich/sigil/actions`);
}

if (conclusion !== "success") {
  console.error(`\nWorkflow ${runId} finished with: ${conclusion}\n`);
  try {
    run(`gh run view ${runId} --log-failed`);
  } catch {
    // log-failed may itself fail if there are no failed steps
  }
  fail(`Release workflow failed (conclusion: ${conclusion})`);
}

console.log(`\nWorkflow ${runId} succeeded.\n`);

// ── Step 7: Verify assets ───────────────────────────────────────────

console.log("=== Step 7: Verifying release assets ===\n");

// Give the release a moment to finalize
await sleep(3000);

const assetsJson = runCapture(`gh release view ${tag} --json assets --jq '.assets[].name'`);
const assets = assetsJson.split("\n").filter(Boolean);

if (assets.length === 0) {
  fail(`Release ${tag} has no assets. The DMG was not uploaded.`);
}

console.log(`Release ${tag} assets:`);
for (const a of assets) {
  console.log(`  - ${a}`);
}

const hasDmg = assets.some((a) => a.endsWith(".dmg"));
if (!hasDmg) {
  fail(`Release ${tag} has no DMG file.`);
}

console.log(`\nRelease ${tag} complete. DMG available at:`);
console.log(`https://github.com/gitlevich/sigil/releases/tag/${tag}\n`);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
