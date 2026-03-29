# Release Setup

## One-time setup

### 1. Generate the updater signing key pair

```bash
npx tauri signer generate -w src-tauri/.tauri-updater-key
```

This creates two files:
- `src-tauri/.tauri-updater-key` (private key - NEVER commit this)
- `src-tauri/.tauri-updater-key.pub` (public key)

Copy the public key contents into `tauri.conf.json` under `plugins.updater.pubkey`.

### 2. Set GitHub repository secrets

Go to **Settings > Secrets and variables > Actions** in the GitHub repo and add:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `src-tauri/.tauri-updater-key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password you chose during key generation |
| `APPLE_CERTIFICATE` | Base64-encoded .p12 export of your Developer ID Application certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the .p12 file |
| `APPLE_SIGNING_IDENTITY` | e.g., `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_PASSWORD` | App-specific password (generate at appleid.apple.com) |
| `APPLE_TEAM_ID` | Your Apple Developer Team ID |

### 3. Export your Apple certificate as base64

```bash
# Export from Keychain Access as .p12, then:
base64 -i Certificates.p12 | pbcopy
# Paste into the APPLE_CERTIFICATE secret
```

## Releasing

1. Bump the version in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`
2. Commit
3. Tag and push:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The GitHub Action will:
- Build for both Apple Silicon (aarch64) and Intel (x86_64)
- Code sign and notarize the .dmg
- Create a GitHub Release with the .dmg files
- Generate `latest.json` for the auto-updater

Users running Sigil will be prompted to update on next launch.
