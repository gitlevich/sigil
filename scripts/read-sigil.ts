/**
 * Read a sigil subtree as a single JSON object.
 *
 * Usage: npx tsx scripts/read-sigil.ts [path]
 *
 *   path: slash-separated path from spec root, e.g. "DesignPartner/BicameralMind/RightHemisphere"
 *         Omit to read the entire spec root.
 *
 * Output: JSON to stdout. The object shape matches sigil-core's Sigil type:
 *   { name, language, affordances: [{name, content}], invariants: [{name, content}], children: [Sigil...] }
 *
 * This tool exists so that Claude (the design partner) can ingest a full sigil
 * subtree — language, affordances, invariants, and children — in one read,
 * instead of stitching together dozens of separate file reads.
 */
import * as fs from "fs";
import * as path from "path";

interface Affordance {
  name: string;
  content: string;
}

interface Invariant {
  name: string;
  content: string;
}

interface Sigil {
  name: string;
  language: string;
  affordances: Affordance[];
  invariants: Invariant[];
  children: Sigil[];
}

function isSigilDir(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "language.md")) ||
    fs.existsSync(path.join(dir, "spec.md"))
  );
}

function readSigil(dir: string): Sigil {
  const name = path.basename(dir);
  const langPath = path.join(dir, "language.md");
  const specPath = path.join(dir, "spec.md");
  const language = fs.existsSync(langPath)
    ? fs.readFileSync(langPath, "utf-8")
    : fs.existsSync(specPath)
      ? fs.readFileSync(specPath, "utf-8")
      : "";

  const affordances: Affordance[] = [];
  const invariants: Invariant[] = [];
  const children: Sigil[] = [];

  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile()) {
      const match = entry.name.match(/^(affordance|invariant)-(.+)\.md$/);
      if (match) {
        const content = fs.readFileSync(fullPath, "utf-8");
        if (match[1] === "affordance") {
          affordances.push({ name: match[2], content });
        } else {
          invariants.push({ name: match[2], content });
        }
      }
    } else if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "chats") continue;
      if (isSigilDir(fullPath)) {
        children.push(readSigil(fullPath));
      }
    }
  }

  return { name, language, affordances, invariants, children };
}

// ── Main ──

const scriptDir = path.dirname(
  decodeURIComponent(new URL(import.meta.url).pathname),
);
const repoRoot = path.resolve(scriptDir, "..");
const sigilRoot = path.join(repoRoot, "specification.sigil");

if (!fs.existsSync(sigilRoot)) {
  console.error(`Sigil root not found: ${sigilRoot}`);
  process.exit(1);
}

const subpath = process.argv[2] || "";
const targetDir = subpath
  ? path.join(sigilRoot, ...subpath.split("/"))
  : sigilRoot;

if (!fs.existsSync(targetDir)) {
  console.error(`Path not found: ${subpath}`);
  process.exit(1);
}

if (!isSigilDir(targetDir)) {
  console.error(`Not a sigil directory (no language.md): ${subpath}`);
  process.exit(1);
}

const sigil = readSigil(targetDir);
console.log(JSON.stringify(sigil, null, 2));
