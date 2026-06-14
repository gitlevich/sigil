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

interface SpatialLayout {
  version: 1;
  icons: Record<string, { x: number; y: number }>;
  scroll?: { x: number; y: number; w: number; h: number; open?: boolean };
}

interface Sigil {
  name: string;
  language: string;
  affordances: Affordance[];
  invariants: Invariant[];
  children: Sigil[];
  vision?: string;
  spatialLayout?: SpatialLayout;
}

/** Read a sigil's saved Spatial-desktop layout, if any, so the read-only web
 * viewer can mirror the arrangement saved in the editor. */
function readSpatialLayout(dir: string): SpatialLayout | undefined {
  const file = path.join(dir, "spatial.layout.json");
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as SpatialLayout;
    if (parsed && parsed.version === 1 && typeof parsed.icons === "object") return parsed;
  } catch {
    // Malformed layout — fall back to deterministic placement in the viewer.
  }
  return undefined;
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

  const spatialLayout = readSpatialLayout(dir);

  return { name, language, affordances, invariants, children, ...(spatialLayout ? { spatialLayout } : {}) };
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

// The vision document lives at the root, parallel to the taxonomy (matching the
// Rust backend, which reads root vision.md into Idea.vision).
const rootVisionPath = path.join(sigilRoot, "vision.md");
if (fs.existsSync(rootVisionPath)) {
  sigil.vision = fs.readFileSync(rootVisionPath, "utf-8");
}

// Ensure output directory exists
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(sigil, null, 2));

const contextCount = (function count(ctx: Sigil): number {
  return 1 + ctx.children.reduce((s, c) => s + count(c), 0);
})(sigil);

console.log(
  `Exported ${contextCount} contexts to ${path.relative(process.cwd(), outputPath)}`
);
