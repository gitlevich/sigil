/**
 * Export a sigil directory tree to JSON for the web viewer.
 *
 * Usage: npx tsx scripts/export-sigil-json.ts [sigil-root] [output-path]
 *
 * Defaults:
 *   sigil-root:  specification.sigil
 *   output-path: site/src/data/sigil-spec.json
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

function languageFile(dir: string): string {
  const lang = path.join(dir, "language.md");
  if (fs.existsSync(lang)) return lang;
  const spec = path.join(dir, "spec.md");
  if (fs.existsSync(spec)) return spec;
  return lang;
}

function isSigilDir(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "language.md")) ||
    fs.existsSync(path.join(dir, "spec.md"))
  );
}

function readSigil(dir: string): Sigil {
  const name = path.basename(dir);
  const langPath = languageFile(dir);
  const language = fs.existsSync(langPath)
    ? fs.readFileSync(langPath, "utf-8")
    : "";

  const affordances: Affordance[] = [];
  const invariants: Invariant[] = [];
  const children: Sigil[] = [];

  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
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

  // Keep Libs at the end, matching Rust backend behavior
  children.sort((a, b) => {
    if (a.name === "Libs") return 1;
    if (b.name === "Libs") return -1;
    return 0;
  });

  return { name, language, affordances, invariants, children };
}

const scriptDir = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const repoRoot = path.resolve(scriptDir, "..");

const sigilRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, "specification.sigil");

const outputPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(repoRoot, "site/src/data/sigil-spec.json");

if (!fs.existsSync(sigilRoot)) {
  console.error(`Sigil root not found: ${sigilRoot}`);
  process.exit(1);
}

const sigil = readSigil(sigilRoot) as Sigil;

// Ensure output directory exists
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(sigil, null, 2));

const contextCount = (function count(ctx: Sigil): number {
  return 1 + ctx.children.reduce((s, c) => s + count(c), 0);
})(sigil);

console.log(
  `Exported ${contextCount} contexts to ${path.relative(process.cwd(), outputPath)}`
);
