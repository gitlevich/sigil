import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface Options {
  root: string;
  message: string;
  timeoutMs: number;
  currentPath?: string[];
  listen: boolean;
  disconnect: boolean;
  openWorkspace: boolean;
  appPath?: string;
}

interface Discovery {
  protocol: string;
  host: string;
  port: number;
  token: string;
  rootPath: string;
  pid: number;
}

interface BridgeEvent {
  type: string;
  requestId?: string;
  ok?: boolean;
  message?: string;
  protocol?: string;
  rootPath?: string;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultDevAppPath = path.resolve(
  scriptDir,
  "../src-tauri/target/debug/bundle/macos/Sigil.app",
);

function usage(): string {
  return [
    "Usage:",
    "  npm run talk -- --root /path/to/workspace.sigil --message \"Ask B this\"",
    "  npm run talk -- --root /path/to/workspace.sigil --listen",
    "  npm run talk -- --root /path/to/workspace.sigil --disconnect",
    "  npm run talk -- --root /path/to/workspace.sigil --open --listen",
    "  npm run talk -- --root /path/to/workspace.sigil --current-path DesignPartner --timeout 300000 --message \"...\"",
    "",
    "Sigil must be open on that workspace. The command connects to the live",
    "external AI bridge from <workspace>/.private/external-ai/server.json,",
    "waits for the Design Partner response, and prints the final answer.",
    "By default this command never opens Sigil. With --open, if no live bridge",
    "is present, it opens the local debug Sigil.app for that workspace and waits",
    "for registration. Use --app to override the app path.",
    "With --listen, the socket stays open; type a message and press Enter to talk,",
    "or type /disconnect to close the bridge session.",
  ].join("\n");
}

function parseArgs(argv: string[]): Options {
  let root = "";
  let message = "";
  let timeoutMs = 300_000;
  let currentPath: string[] | undefined;
  let listen = false;
  let disconnect = false;
  let openWorkspace = false;
  let appPath: string | undefined;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      root = argv[++i] ?? "";
    } else if (arg === "--message") {
      message = argv[++i] ?? "";
    } else if (arg === "--timeout") {
      const raw = argv[++i] ?? "";
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --timeout value: ${raw}`);
      }
      timeoutMs = parsed;
    } else if (arg === "--current-path") {
      const raw = argv[++i] ?? "";
      currentPath = raw.split("/").filter(Boolean);
    } else if (arg === "--listen") {
      listen = true;
    } else if (arg === "--disconnect") {
      disconnect = true;
    } else if (arg === "--open") {
      openWorkspace = true;
    } else if (arg === "--no-open") {
      openWorkspace = false;
    } else if (arg === "--app") {
      appPath = argv[++i] ?? "";
    } else if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    } else {
      rest.push(arg);
    }
  }

  if (!message && rest.length > 0) {
    message = rest.join(" ");
  }
  if (!root) {
    throw new Error(`Missing --root.\n\n${usage()}`);
  }
  if (!message.trim() && !listen && !disconnect) {
    throw new Error(`Missing --message.\n\n${usage()}`);
  }
  if (listen && disconnect) {
    throw new Error("--listen and --disconnect are mutually exclusive");
  }
  return {
    root: path.resolve(root),
    message: message.trim(),
    timeoutMs,
    currentPath,
    listen,
    disconnect,
    openWorkspace,
    appPath: appPath ? path.resolve(appPath) : undefined,
  };
}

async function readDiscovery(root: string): Promise<Discovery> {
  const discoveryPath = path.join(
    root,
    ".private",
    "external-ai",
    "server.json",
  );
  let raw: string;
  try {
    raw = await readFile(discoveryPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`No live Sigil external AI bridge found at ${discoveryPath}: ${message}`);
  }
  const discovery = JSON.parse(raw) as Discovery;
  if (discovery.protocol !== "sigil-external-ai-jsonl-v1") {
    throw new Error(`Unsupported external AI bridge protocol: ${discovery.protocol}`);
  }
  return discovery;
}

async function tryReadDiscovery(root: string): Promise<Discovery | null> {
  try {
    return await readDiscovery(root);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canConnect(discovery: Discovery, timeoutMs = 1_500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: discovery.host, port: discovery.port });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
    socket.on("close", () => finish(false));
  });
}

async function openWorkspaceInSigil(root: string, appPath: string): Promise<void> {
  await access(appPath);
  await new Promise<void>((resolve, reject) => {
    const child = spawn("open", ["-a", appPath, root], {
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`open exited with status ${code ?? "unknown"}`));
      }
    });
  });
}

async function resolveDiscovery(options: Options, allowOpen: boolean): Promise<Discovery> {
  const existing = await tryReadDiscovery(options.root);
  if (existing && await canConnect(existing)) {
    return existing;
  }
  if (!allowOpen || !options.openWorkspace) {
    return readDiscovery(options.root);
  }

  const appPath = options.appPath ?? defaultDevAppPath;
  process.stderr.write(`opening: ${appPath}\n`);
  await openWorkspaceInSigil(options.root, appPath);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const discovery = await tryReadDiscovery(options.root);
    if (discovery && await canConnect(discovery)) {
      return discovery;
    }
    await sleep(500);
  }

  throw new Error(`Timed out waiting for Sigil to register ${options.root}`);
}

function talk(options: Options, discovery: Discovery): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestId = `external-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const socket = net.createConnection({ host: discovery.host, port: discovery.port });
    let buffer = "";
    let settled = false;

    const finish = (err: Error | null, message?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(message ?? "");
    };

    socket.setTimeout(options.timeoutMs + 5_000, () => {
      finish(new Error(`Timed out waiting for Sigil to complete ${requestId}`));
    });

    socket.on("connect", () => {
      const request = {
        type: "send",
        token: discovery.token,
        requestId,
        rootPath: discovery.rootPath,
        message: options.message,
        currentPath: options.currentPath,
        timeoutMs: options.timeoutMs,
      };
      socket.write(`${JSON.stringify(request)}\n`);
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;

        let event: BridgeEvent;
        try {
          event = JSON.parse(line) as BridgeEvent;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          finish(new Error(`Malformed bridge response: ${message}`));
          return;
        }

        if (event.type === "hello" || event.type === "accepted") {
          continue;
        }
        if (event.type === "ack") {
          process.stderr.write(`${event.ok ? "ack" : "nack"}: ${event.message ?? ""}\n`);
          continue;
        }
        if (event.type === "error") {
          finish(new Error(event.message ?? "External AI bridge error"));
          return;
        }
        if (event.type === "final") {
          if (event.ok) {
            finish(null, event.message ?? "");
          } else {
            finish(new Error(event.message ?? "External AI request failed"));
          }
          return;
        }
      }
    });

    socket.on("error", (err) => finish(err));
    socket.on("close", () => {
      if (!settled) {
        finish(new Error("External AI bridge closed before a final response"));
      }
    });
  });
}

function sendTurn(
  socket: net.Socket,
  discovery: Discovery,
  options: Options,
  message: string,
): string {
  const requestId = `external-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const request = {
    type: "send",
    token: discovery.token,
    requestId,
    rootPath: discovery.rootPath,
    message,
    currentPath: options.currentPath,
    timeoutMs: options.timeoutMs,
  };
  socket.write(`${JSON.stringify(request)}\n`);
  return requestId;
}

function disconnect(discovery: Discovery): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: discovery.host, port: discovery.port });
    let buffer = "";
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    socket.setTimeout(5_000, () => finish(new Error("Timed out waiting for disconnect")));
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({
        type: "disconnect",
        token: discovery.token,
        rootPath: discovery.rootPath,
      })}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;
        const event = JSON.parse(line) as BridgeEvent;
        if (event.type === "disconnected") {
          process.stderr.write(`disconnected: ${event.ok ? "ok" : "no listener"}\n`);
          finish();
          return;
        }
        if (event.type === "error") {
          finish(new Error(event.message ?? "External AI bridge error"));
          return;
        }
      }
    });
    socket.on("error", finish);
    socket.on("close", () => finish(new Error("External AI bridge closed before disconnect completed")));
  });
}

function listen(options: Options, discovery: Discovery): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: discovery.host, port: discovery.port });
    let buffer = "";
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      process.stdin.pause();
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    socket.on("connect", () => {
      socket.write(`${JSON.stringify({
        type: "listen",
        token: discovery.token,
        rootPath: discovery.rootPath,
      })}\n`);
      if (options.message) {
        sendTurn(socket, discovery, options, options.message);
      }
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;

        let event: BridgeEvent;
        try {
          event = JSON.parse(line) as BridgeEvent;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          finish(new Error(`Malformed bridge response: ${message}`));
          return;
        }

        if (event.type === "hello") continue;
        if (event.type === "listening") {
          process.stderr.write(`listening: ${discovery.rootPath}\n`);
          continue;
        }
        if (event.type === "accepted") continue;
        if (event.type === "ack") {
          process.stderr.write(`${event.ok ? "ack" : "nack"}: ${event.message ?? ""}\n`);
          continue;
        }
        if (event.type === "agentMessage") {
          process.stdout.write(`B: ${event.message ?? ""}\n`);
          continue;
        }
        if (event.type === "final") {
          process.stdout.write(`B: ${event.message ?? ""}\n`);
          continue;
        }
        if (event.type === "disconnect" || event.type === "disconnected") {
          process.stderr.write(`${event.type}: ${event.message ?? ""}\n`);
          finish();
          return;
        }
        if (event.type === "error") {
          finish(new Error(event.message ?? "External AI bridge error"));
          return;
        }
      }
    });

    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.on("data", (chunk) => {
      for (const rawLine of String(chunk).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line === "/disconnect") {
          socket.write(`${JSON.stringify({
            type: "disconnect",
            token: discovery.token,
            rootPath: discovery.rootPath,
          })}\n`);
          continue;
        }
        sendTurn(socket, discovery, options, line);
      }
    });

    socket.on("error", finish);
    socket.on("close", () => {
      if (!settled) finish(new Error("External AI bridge closed"));
    });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const options = parseArgs(argv);
  if (options.disconnect) {
    const discovery = await resolveDiscovery(options, false);
    await disconnect(discovery);
    return;
  }
  const discovery = await resolveDiscovery(options, true);
  if (options.listen) {
    await listen(options, discovery);
    return;
  }
  const response = await talk(options, discovery);
  process.stdout.write(`${response}\n`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
