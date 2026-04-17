/**
 * Render a sigil as the user sees it — one perceptual unit.
 *
 * A sigil is not a bunch of files; it is a thing with a name, a language,
 * affordances, invariants, and children. This script assembles that view
 * from the directory so you can read a sigil in one call.
 *
 * Usage:
 *   npx tsx scripts/show-sigil.ts <path>
 *
 * Path is resolved relative to specification.sigil/, then absolute.
 * Examples:
 *   npx tsx scripts/show-sigil.ts DesignPartner/BicameralMind/Memory/Path
 *   npx tsx scripts/show-sigil.ts Libs/AttentionLanguage/Sigil
 *   npx tsx scripts/show-sigil.ts .                    (the root sigil)
 */
import * as fs from "fs";
import * as path from "path";

const SPEC_ROOT = path.join(process.cwd(), "specification.sigil");

function resolveSigilDir(arg: string): string {
  if (path.isAbsolute(arg) && fs.existsSync(arg)) return arg;
  const relToSpec = path.join(SPEC_ROOT, arg);
  if (fs.existsSync(relToSpec)) return relToSpec;
  const relToCwd = path.resolve(process.cwd(), arg);
  if (fs.existsSync(relToCwd)) return relToCwd;
  throw new Error(`No sigil found at: ${arg}`);
}

function readIfExists(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function stripFrontmatter(text: string): { frontmatter: string | null; body: string } {
  if (!text.startsWith("---\n")) return { frontmatter: null, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: null, body: text };
  return {
    frontmatter: text.slice(4, end),
    body: text.slice(end + 5).replace(/^\n+/, ""),
  };
}

function statusFrom(frontmatter: string | null): string | null {
  if (!frontmatter) return null;
  const match = frontmatter.match(/^status:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Extract whose "I" is speaking, if the opening declares it.
 *
 * Every language.md is first-person. Scoped sigils name whose first-person
 * with phrasing like "I am the @DesignPartner" near the top. Generic sigils
 * omit this — any attention reading becomes the "I".
 */
function voiceFrom(body: string): string {
  const paragraphs = body.split(/\n\s*\n/);
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    const match = trimmed.match(/I am (?:the\s+)?(@\w+)/);
    return match ? match[1] : "whoever reads";
  }
  return "whoever reads";
}

function listPropertyFiles(dir: string, prefix: "affordance" | "invariant"): Array<{ name: string; body: string }> {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir);
  const pattern = new RegExp(`^${prefix}-(.+)\\.md$`);
  const items: Array<{ name: string; body: string }> = [];
  for (const entry of entries) {
    const match = entry.match(pattern);
    if (!match) continue;
    const body = fs.readFileSync(path.join(dir, entry), "utf8").trim();
    items.push({ name: match[1], body });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

function listChildren(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const children: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    children.push(entry.name);
  }
  children.sort();
  return children;
}

function indentBlock(text: string, indent: string): string {
  return text.split("\n").map((line) => (line.length > 0 ? indent + line : line)).join("\n");
}

function render(sigilDir: string): string {
  const name = path.basename(sigilDir) === "specification.sigil"
    ? path.basename(path.resolve(sigilDir, ".."))
    : path.basename(sigilDir);
  const rel = path.relative(SPEC_ROOT, sigilDir) || ".";

  const languagePath = path.join(sigilDir, "language.md");
  const langText = readIfExists(languagePath) ?? readIfExists(path.join(sigilDir, "spec.md"));
  const { frontmatter, body: language } = langText
    ? stripFrontmatter(langText)
    : { frontmatter: null, body: "" };
  const status = statusFrom(frontmatter);

  const affordances = listPropertyFiles(sigilDir, "affordance");
  const invariants = listPropertyFiles(sigilDir, "invariant");
  const children = listChildren(sigilDir);

  const lines: string[] = [];
  lines.push(`@${name}   (${rel})`);
  if (status) lines.push(`status: ${status}`);
  if (language.trim()) lines.push(`voice:  ${voiceFrom(language)}`);
  lines.push("");

  if (language.trim()) {
    lines.push("language:");
    lines.push(indentBlock(language.trim(), "  "));
    lines.push("");
  } else {
    lines.push("language: (none)");
    lines.push("");
  }

  if (invariants.length > 0) {
    lines.push(`invariants (${invariants.length}):`);
    for (const inv of invariants) {
      lines.push(`  !${inv.name}`);
      lines.push(indentBlock(inv.body, "    "));
      lines.push("");
    }
  } else {
    lines.push("invariants: (none)");
    lines.push("");
  }

  if (affordances.length > 0) {
    lines.push(`affordances (${affordances.length}):`);
    for (const aff of affordances) {
      lines.push(`  #${aff.name}`);
      lines.push(indentBlock(aff.body, "    "));
      lines.push("");
    }
  } else {
    lines.push("affordances: (none)");
    lines.push("");
  }

  if (children.length > 0) {
    lines.push(`children (${children.length}):`);
    for (const child of children) {
      lines.push(`  @${child}`);
    }
  } else {
    lines.push("children: (none)");
  }

  return lines.join("\n");
}

const arg = process.argv[2];
if (!arg) {
  console.error("usage: npx tsx scripts/show-sigil.ts <path>");
  process.exit(2);
}

try {
  const sigilDir = resolveSigilDir(arg);
  console.log(render(sigilDir));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
