import { save, message } from "@tauri-apps/plugin-dialog";
import { api, openInNewWindow } from "../tauri";

const SIGIL_EXTENSION = ".sigil";

export function ensureSigilExtension(path: string): string {
  const trimmed = path.trim();
  if (trimmed.toLowerCase().endsWith(SIGIL_EXTENSION)) return trimmed;
  return `${trimmed}${SIGIL_EXTENSION}`;
}

export async function createNewSigil(rootPath: string): Promise<string> {
  const normalizedPath = ensureSigilExtension(rootPath);
  await api.scaffoldSigil(normalizedPath);
  return normalizedPath;
}

export async function chooseNewSigilPath(): Promise<string | null> {
  const selected = await save({
    title: "New Sigil",
    defaultPath: "Untitled.sigil",
    filters: [{ name: "Sigil", extensions: ["sigil"] }],
  });
  return selected ? ensureSigilExtension(selected) : null;
}

export async function createNewSigilFromMenu(): Promise<void> {
  const rootPath = await chooseNewSigilPath();
  if (!rootPath) return;

  try {
    await createNewSigil(rootPath);
    openInNewWindow(rootPath);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await message(detail, { title: "Cannot create sigil", kind: "error" });
  }
}
