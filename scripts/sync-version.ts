import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8")).version;

// Cargo.toml — replace version line under [package]
const cargoPath = resolve(root, "src-tauri/Cargo.toml");
const cargo = readFileSync(cargoPath, "utf-8");
writeFileSync(cargoPath, cargo.replace(/^version = ".*"/m, `version = "${version}"`));

// tauri.conf.json — replace version field
const tauriPath = resolve(root, "src-tauri/tauri.conf.json");
const tauri = JSON.parse(readFileSync(tauriPath, "utf-8"));
tauri.version = version;
writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + "\n");

console.log(`Synced version ${version} to Cargo.toml and tauri.conf.json`);
