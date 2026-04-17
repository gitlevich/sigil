/**
 * Run the compressor against the real specification.sigil tree.
 * Useful for eyeballing the output size and narrative quality.
 *
 * Usage: npx tsx scripts/compress-spec.ts [subpath]
 *   Default: DesignPartner
 */
import * as fs from "fs";
import * as path from "path";
import type { Sigil } from "../packages/sigil-core/src/types";
import { compressSigil } from "../packages/sigil-core/src/compressor";

const SPEC_ROOT = path.join(process.cwd(), "specification.sigil");

function readSigil(dir: string): Sigil {
  const name = path.basename(dir);
  const langPath = path.join(dir, "language.md");
  const language = fs.existsSync(langPath) ? fs.readFileSync(langPath, "utf8") : "";

  const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
  const affordances = entries
    .filter((e) => e.isFile() && e.name.startsWith("affordance-") && e.name.endsWith(".md"))
    .map((e) => ({
      name: e.name.slice("affordance-".length, -".md".length),
      content: fs.readFileSync(path.join(dir, e.name), "utf8"),
    }));
  const invariants = entries
    .filter((e) => e.isFile() && e.name.startsWith("invariant-") && e.name.endsWith(".md"))
    .map((e) => ({
      name: e.name.slice("invariant-".length, -".md".length),
      content: fs.readFileSync(path.join(dir, e.name), "utf8"),
    }));

  const children = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => readSigil(path.join(dir, e.name)))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { name, language, affordances, invariants, children };
}

const sub = process.argv[2] || "DesignPartner";
const dir = path.join(SPEC_ROOT, sub);
if (!fs.existsSync(dir)) {
  console.error(`No such directory: ${dir}`);
  process.exit(1);
}

const tree = readSigil(dir);
const compressed = compressSigil(tree);
console.log(compressed);
console.log("\n---");
console.log(`${compressed.length} chars, approx ${Math.round(compressed.length / 4)} tokens`);
