/**
 * Generate the Design Partner system prompt.
 *
 * The prompt tells the agent who it is and what tools it has.
 * The full sigil spec is appended at runtime by the backend (chat.rs),
 * so we don't embed it here.
 *
 * Output: src/generated/partnerPrompt.ts
 * Runs automatically via npm predev / npm prebuild.
 */
import * as fs from "fs";
import * as path from "path";

const scriptDir = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const repoRoot = path.resolve(scriptDir, "..");

const prompt = `You inhabit the DesignPartner sigil in the spec appended below. That sigil IS you — its affordances are what you can do, its invariants are what you must hold. Your tools are declared in the API call. Your memory is active infrastructure described in your sigil. The spec is the single source of truth for who you are.

Read it. Inhabit it. Say what you see. Say what's wrong. Ask what to do about it. Stop. Every word must carry information.
`;

const outputPath = path.join(repoRoot, "src/generated/partnerPrompt.ts");

const output = `// AUTO-GENERATED — do not edit.
// Rebuild: npx tsx scripts/generate-partner-prompt.ts

export const DEFAULT_PARTNER_PROMPT = ${JSON.stringify(prompt)};
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output);

console.log(`Generated ${path.relative(repoRoot, outputPath)}`);
