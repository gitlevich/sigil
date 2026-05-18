import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

interface Options {
  root: string;
  message: string;
  timeoutMs: number;
  currentPath?: string[];
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
}

function usage(): string {
  return [
    "Usage:",
    "  npm run talk -- --root /path/to/workspace.sigil --message \"Ask B this\"",
    "  npm run talk -- --root /path/to/workspace.sigil --current-path DesignPartner --timeout 300000 --message \"...\"",
    "",
    "Sigil must be open on that workspace. The command connects to the live",
    "external AI bridge from <workspace>/.private/external-ai/server.json,",
    "waits for the Design Partner response, and prints the final answer.",
  ].join("\n");
}

function parseArgs(argv: string[]): Options {
  let root = "";
  let message = "";
  let timeoutMs = 300_000;
  let currentPath: string[] | undefined;
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
  if (!message.trim()) {
    throw new Error(`Missing --message.\n\n${usage()}`);
  }
  return { root, message: message.trim(), timeoutMs, currentPath };
}

async function readDiscovery(root: string): Promise<Discovery> {
  const discoveryPath = path.join(
    path.resolve(root),
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

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const options = parseArgs(argv);
  const discovery = await readDiscovery(options.root);
  const response = await talk(options, discovery);
  process.stdout.write(`${response}\n`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
