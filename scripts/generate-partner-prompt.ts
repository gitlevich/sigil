/**
 * Generate the Design Partner system prompt by compiling the spec.
 *
 * The prompt is assembled from three layers:
 *   1. Prompt sigil    — partner identity and interaction contract
 *   2. AttentionLanguage — the complete ontology (all terms the partner needs)
 *   3. DesignPartner   — operational spec (coherence, coverage, and their children)
 *
 * No duplication. The prompt IS the spec, compiled for an LLM.
 *
 * Output: src/generated/partnerPrompt.ts
 * Runs automatically via npm prebuild.
 */
import * as fs from "fs";
import * as path from "path";

const scriptDir = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const repoRoot = path.resolve(scriptDir, "..");
const specRoot = path.join(repoRoot, "docs/specification/sigil-editor");

function stripFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n*/, "");
}

function stripRefs(text: string): string {
  return text.replace(/@(\w+@)?(\w+)(#[\w-]+|![\w-]+)?/g, (_match, _lib, name, prop) => {
    if (prop) return `${name}${prop}`;
    return name;
  });
}

function readLanguage(relPath: string): string {
  const filePath = path.join(specRoot, relPath);
  if (!fs.existsSync(filePath)) return "";
  return stripRefs(stripFrontmatter(fs.readFileSync(filePath, "utf-8"))).trim();
}

/** Recursively collect all language.md files under a directory, depth-first. */
function collectLanguages(dir: string, relBase: string): string[] {
  const results: string[] = [];
  const langFile = path.join(dir, "language.md");

  if (fs.existsSync(langFile)) {
    const content = readLanguage(path.relative(specRoot, langFile));
    if (content) results.push(content);
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith(".") && e.name !== "chats")
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const childDir = path.join(dir, entry.name);
    if (fs.existsSync(path.join(childDir, "language.md"))) {
      results.push(...collectLanguages(childDir, path.join(relBase, entry.name)));
    }
  }

  return results;
}

// Layer 1: Partner identity
const prompt = readLanguage("Application/DesignPartner/Persona/Prompt/language.md");

// Layer 2: AttentionLanguage ontology — every term defined
const ontologyDir = path.join(specRoot, "Libs/AttentionLanguage");
const ontology = collectLanguages(ontologyDir, "Libs/AttentionLanguage");

// Layer 3: DesignPartner operational spec (but skip Prompt — already in layer 1)
const partnerDir = path.join(specRoot, "Application/DesignPartner");
const partnerAll = collectLanguages(partnerDir, "Application/DesignPartner");
// The first entry is DesignPartner/language.md itself; Prompt is somewhere in the list
const partner = partnerAll.filter(text => !text.startsWith("# Prompt"));

const combined = [
  prompt,
  "---\n\n## Ontology\n\nThe following terms define the language you work in.\n",
  ...ontology,
  "---\n\n## Your Operating Spec\n",
  ...partner,
].join("\n\n");

const outputPath = path.join(repoRoot, "src/generated/partnerPrompt.ts");

const output = `// AUTO-GENERATED from spec sigils — do not edit.
// Rebuild: npx tsx scripts/generate-partner-prompt.ts

export const DEFAULT_PARTNER_PROMPT = ${JSON.stringify(combined)};
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output);

const totalSigils = 1 + ontology.length + partner.length;
console.log(`Generated ${path.relative(repoRoot, outputPath)} from ${totalSigils} spec sigils`);
