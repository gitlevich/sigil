/**
 * Validate all @references, #affordances, and !invariants in a sigil spec.
 *
 * Uses the same resolution logic as the in-app compiler (useCompileCheck.ts):
 * sigil-core's resolve(), findAffordanceInScope, findInvariantInScope with
 * full 5-level lexical scoping (children, siblings, ancestors, libs, proximity).
 *
 * Usage: npx tsx scripts/compile-check.ts [sigil-root]
 *   Default sigil-root: specification.sigil
 *
 * Exit 0 if all references resolve. Exit 1 if any are unresolved.
 */
import * as fs from "fs";
import * as path from "path";
import type { Sigil } from "sigil-core";
import {
  allRefsPattern,
  isInCodeSpan,
  findAffordanceInScope,
  findInvariantInScope,
  resolve,
} from "sigil-core";

// ── Filesystem → Sigil tree ──

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

  const affordances: { name: string; content: string }[] = [];
  const invariants: { name: string; content: string }[] = [];
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
      if (entry.name === "Libs") continue;
      if (isSigilDir(fullPath)) {
        children.push(readSigil(fullPath));
      }
    }
  }

  return { name, language, affordances, invariants, children };
}

function readLibs(sigilRoot: string): Sigil | null {
  const libsDir = path.join(sigilRoot, "Libs");
  if (!fs.existsSync(libsDir) || !isSigilDir(libsDir)) return null;
  const libs = readSigilWithLibs(libsDir);
  libs.isImported = true;
  markImported(libs);
  return libs;
}

/** Like readSigil but does NOT skip Libs subdirs (for reading the Libs tree itself). */
function readSigilWithLibs(dir: string): Sigil {
  const name = path.basename(dir);
  const langPath = languageFile(dir);
  const language = fs.existsSync(langPath)
    ? fs.readFileSync(langPath, "utf-8")
    : "";

  const affordances: { name: string; content: string }[] = [];
  const invariants: { name: string; content: string }[] = [];
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
        children.push(readSigilWithLibs(fullPath));
      }
    }
  }

  return { name, language, affordances, invariants, children };
}

function markImported(sigil: Sigil): void {
  sigil.isImported = true;
  for (const child of sigil.children) markImported(child);
}

// ── Parse a reference token ──

interface ParsedRef {
  segments: string[]; // @A@B@C → ["A", "B", "C"]
  property?: { prefix: "#" | "!"; name: string };
}

function parseRef(token: string): ParsedRef | null {
  if (token.startsWith("#")) {
    return { segments: [], property: { prefix: "#", name: token.slice(1) } };
  }
  if (token.startsWith("!")) {
    return { segments: [], property: { prefix: "!", name: token.slice(1) } };
  }
  // Starts with @
  const withoutAt = token.slice(1);
  let property: ParsedRef["property"];
  let segmentStr = withoutAt;
  const propMatch = withoutAt.match(/([#!])([a-zA-Z_][\w-]*)$/);
  if (propMatch) {
    property = { prefix: propMatch[1] as "#" | "!", name: propMatch[2] };
    segmentStr = withoutAt.slice(0, propMatch.index);
  }
  const segments = segmentStr.split("@").filter(Boolean);
  return { segments, property };
}

// ── Walk files and check ──

interface RefError {
  file: string;
  line: number;
  ref: string;
  reason: string;
}

function collectFiles(dir: string, relPrefix: string): { absPath: string; relPath: string }[] {
  const results: { absPath: string; relPath: string }[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "chats") continue;
    const abs = path.join(dir, entry.name);
    const rel = path.join(relPrefix, entry.name);
    if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push({ absPath: abs, relPath: rel });
    } else if (entry.isDirectory()) {
      results.push(...collectFiles(abs, rel));
    }
  }
  return results;
}

function pathForFile(sigilRoot: string, filePath: string): string[] {
  const rel = path.relative(sigilRoot, filePath);
  const parts = rel.split(path.sep);
  parts.pop(); // remove filename
  return parts;
}

function checkFile(
  root: Sigil,
  sigilRoot: string,
  filePath: string,
  relPath: string,
  importedOntologies: Sigil | null,
): { errors: RefError[]; refCount: number } {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const currentPath = pathForFile(sigilRoot, filePath);
  const errors: RefError[] = [];
  let refCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    allRefsPattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = allRefsPattern.exec(line)) !== null) {
      if (isInCodeSpan(line, m.index)) continue;
      const token = m[0];
      const parsed = parseRef(token);
      if (!parsed) continue;
      refCount++;

      if (parsed.segments.length > 0) {
        // Sigil reference: use resolve() from sigil-core
        const sigilRef = "@" + parsed.segments.join("@");
        const resolved = resolve(root, currentPath, sigilRef, importedOntologies);
        if (!resolved) {
          errors.push({ file: relPath, line: i + 1, ref: token, reason: "unresolved sigil" });
          continue;
        }
        // Check property on resolved target
        if (parsed.property) {
          if (parsed.property.prefix === "#") {
            if (!findAffordanceInScope(root, resolved.path, parsed.property.name, importedOntologies)) {
              errors.push({ file: relPath, line: i + 1, ref: token, reason: "unresolved affordance" });
            }
          } else {
            if (!findInvariantInScope(root, resolved.path, parsed.property.name, importedOntologies)) {
              errors.push({ file: relPath, line: i + 1, ref: token, reason: "unresolved invariant" });
            }
          }
        }
      } else if (parsed.property) {
        // Bare #affordance or !invariant
        if (parsed.property.prefix === "#") {
          if (!findAffordanceInScope(root, currentPath, parsed.property.name, importedOntologies)) {
            errors.push({ file: relPath, line: i + 1, ref: token, reason: "unresolved affordance" });
          }
        } else {
          if (!findInvariantInScope(root, currentPath, parsed.property.name, importedOntologies)) {
            errors.push({ file: relPath, line: i + 1, ref: token, reason: "unresolved invariant" });
          }
        }
      }
    }
  }

  return { errors, refCount };
}

// ── Main ──

const scriptDir = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const repoRoot = path.resolve(scriptDir, "..");

const sigilRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, "specification.sigil");

if (!fs.existsSync(sigilRoot)) {
  console.error(`Sigil root not found: ${sigilRoot}`);
  process.exit(1);
}

// Build tree: root sigil with Libs mounted as a child
const root = readSigil(sigilRoot);
const libs = readLibs(sigilRoot);
if (libs) {
  root.children.push(libs);
}
const importedOntologies = libs ?? null;

// Collect and check all .md files
const files = collectFiles(sigilRoot, "");

let totalRefs = 0;
const allErrors: RefError[] = [];
const filesWithErrors = new Set<string>();

for (const { absPath, relPath } of files) {
  const { errors, refCount } = checkFile(root, sigilRoot, absPath, relPath, importedOntologies);
  totalRefs += refCount;
  if (errors.length > 0) {
    allErrors.push(...errors);
    filesWithErrors.add(relPath);
  }
}

if (allErrors.length === 0) {
  console.log(`compile-check: ${totalRefs} references checked across ${files.length} files — all resolve`);
  process.exit(0);
}

// Group errors by file
const byFile = new Map<string, RefError[]>();
for (const err of allErrors) {
  const list = byFile.get(err.file) ?? [];
  list.push(err);
  byFile.set(err.file, list);
}

for (const [file, errs] of byFile) {
  console.log(`\n${file}`);
  for (const err of errs) {
    console.log(`  ${err.line}: ${err.ref}  — ${err.reason}`);
  }
}

console.log(`\n${totalRefs} references checked, ${allErrors.length} unresolved, ${filesWithErrors.size} file(s) with errors`);
process.exit(1);
