/**
 * Validate all @references, #affordances, and !invariants in a sigil spec.
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
  findContext,
  buildLexicalScope,
  resolveRefName,
  findAffordanceInScope,
  findInvariantInScope,
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

// ── Reference pattern (from sigilExtensions.ts:76) ──

const allRefsPattern =
  /@[a-zA-Z_][\w-]*(?:@[a-zA-Z_][\w-]*)*(?:[#!][a-zA-Z_][\w-]*)?|#[a-zA-Z_][\w-]*|![a-zA-Z_][\w-]*/g;

function isInCodeSpan(lineText: string, matchIndex: number): boolean {
  let count = 0;
  for (let i = 0; i < matchIndex; i++) {
    if (lineText[i] === "`") count++;
  }
  return count % 2 === 1;
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

// ── Scope description for error messages ──

function describeScope(root: Sigil, currentPath: string[]): string {
  const scope = buildLexicalScope(root, currentPath);
  const sigils = scope.filter((r) => r.prefix === "@").map((r) => r.name);
  const affs = scope.filter((r) => r.prefix === "#").map((r) => r.name);
  const invs = scope.filter((r) => r.prefix === "!").map((r) => r.name);
  const parts: string[] = [];
  if (sigils.length > 0) parts.push(`@{${sigils.join(", ")}}`);
  if (affs.length > 0) parts.push(`#{${affs.join(", ")}}`);
  if (invs.length > 0) parts.push(`!{${invs.join(", ")}}`);
  return parts.join("  ");
}

// ── Resolve a multi-segment @ref against the tree ──

function resolveSegments(root: Sigil, currentPath: string[], segments: string[]): string[] | null {
  if (segments.length === 0) return currentPath;

  const scope = buildLexicalScope(root, currentPath);
  const sigilNames = scope.filter((r) => r.prefix === "@").map((r) => r.name);
  const firstName = segments[0];
  const resolved = resolveRefName(firstName, sigilNames);
  if (!resolved) return null;

  const targetPath = findSigilPath(root, resolved);
  if (!targetPath) return null;

  if (segments.length === 1) return targetPath;

  let ctx = findContext(root, targetPath);
  const resultPath = [...targetPath];
  for (let i = 1; i < segments.length; i++) {
    const childNames = ctx.children.map((c) => c.name);
    const childResolved = resolveRefName(segments[i], childNames);
    if (!childResolved) return null;
    resultPath.push(childResolved);
    const next = ctx.children.find((c) => c.name === childResolved);
    if (!next) return null;
    ctx = next;
  }
  return resultPath;
}

function findSigilPath(root: Sigil, name: string): string[] | null {
  if (root.name === name) return [];
  return findSigilPathDFS(root, name, []);
}

function findSigilPathDFS(sigil: Sigil, name: string, prefix: string[]): string[] | null {
  for (const child of sigil.children) {
    const childPath = [...prefix, child.name];
    if (child.name === name) return childPath;
    const found = findSigilPathDFS(child, name, childPath);
    if (found) return found;
  }
  return null;
}

// ── Walk files and check ──

interface RefError {
  file: string;
  line: number;
  ref: string;
  reason: string;
  scope: string;
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
): { errors: RefError[]; refCount: number } {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const currentPath = pathForFile(sigilRoot, filePath);
  const errors: RefError[] = [];
  let refCount = 0;

  // Cache scope description per file (same for all refs in the file)
  let scopeDesc: string | undefined;
  const getScope = () => {
    if (scopeDesc === undefined) scopeDesc = describeScope(root, currentPath);
    return scopeDesc;
  };

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

      // Resolve sigil segments
      let targetPath = currentPath;
      if (parsed.segments.length > 0) {
        const resolved = resolveSegments(root, currentPath, parsed.segments);
        if (!resolved) {
          errors.push({
            file: relPath,
            line: i + 1,
            ref: token,
            reason: "unresolved sigil",
            scope: getScope(),
          });
          continue;
        }
        targetPath = resolved;
      }

      // Resolve property
      if (parsed.property) {
        if (parsed.property.prefix === "#") {
          const found = findAffordanceInScope(root, targetPath, parsed.property.name);
          if (!found) {
            errors.push({
              file: relPath,
              line: i + 1,
              ref: token,
              reason: "unresolved affordance",
              scope: getScope(),
            });
          }
        } else {
          const found = findInvariantInScope(root, targetPath, parsed.property.name);
          if (!found) {
            errors.push({
              file: relPath,
              line: i + 1,
              ref: token,
              reason: "unresolved invariant",
              scope: getScope(),
            });
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

// Build tree: root sigil with Libs mounted as a child named "Libs"
const root = readSigil(sigilRoot);
const libs = readLibs(sigilRoot);
if (libs) {
  root.children.push(libs);
}

// Collect and check all .md files
const files = collectFiles(sigilRoot, "");

let totalRefs = 0;
const allErrors: RefError[] = [];
const filesWithErrors = new Set<string>();

for (const { absPath, relPath } of files) {
  const { errors, refCount } = checkFile(root, sigilRoot, absPath, relPath);
  totalRefs += refCount;
  if (errors.length > 0) {
    allErrors.push(...errors);
    filesWithErrors.add(relPath);
  }
}

// All output to stdout for machine readability.

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
    console.log(`       scope: ${err.scope}`);
  }
}

console.log(`\n${totalRefs} references checked, ${allErrors.length} unresolved, ${filesWithErrors.size} file(s) with errors`);
process.exit(1);
