#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { startRelay } from "./relay.js";
import { AppServerClient } from "./appserver.js";
import { REALTIME_METHODS, type RealtimeVoice, type RealtimeVoicesList } from "./types.js";
import type { SandboxMode } from "./session.js";

interface Args {
  command: string;
  port: number;
  host: string;
  cwd: string;
  voice?: RealtimeVoice;
  model?: string;
  sandbox: SandboxMode;
  token?: string;
  noToken: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: argv[0] && !argv[0].startsWith("-") ? argv[0] : "serve",
    port: 8765,
    host: "127.0.0.1",
    cwd: process.cwd(),
    sandbox: "workspace-write",
    noToken: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--port": if (next) { args.port = Number(next); i++; } break;
      case "--host": if (next) { args.host = next; i++; } break;
      case "--cwd": if (next) { args.cwd = next; i++; } break;
      case "--voice": if (next) { args.voice = next as RealtimeVoice; i++; } break;
      case "--model": if (next) { args.model = next; i++; } break;
      case "--sandbox": if (next) { args.sandbox = next as SandboxMode; i++; } break;
      case "--token": if (next) { args.token = next; i++; } break;
      case "--no-token": args.noToken = true; break;
      case "--help": case "-h": args.command = "help"; break;
    }
  }
  return args;
}

const HELP = `runny - vibe code while running

Usage:
  runny serve [options]     Start the relay and serve the phone client
  runny voices              List the voices your account can use

Options:
  --port <n>        Port to listen on (default 8765)
  --host <addr>     Bind address (default 127.0.0.1)
  --cwd <path>      Repository the agent works in (default: current directory)
  --voice <name>    Voice to speak with (default marin)
  --model <name>    Model for the coding agent
  --sandbox <mode>  read-only | workspace-write | danger-full-access
                    (default workspace-write)
  --token <secret>  Require ?token=<secret> on the socket
  --no-token        Run without a token. Only safe behind Tailscale.

Expose it to your phone with:
  tailscale serve --bg <port>
`;

async function listVoices(): Promise<void> {
  const client = await AppServerClient.start();
  try {
    const result = await client.request<RealtimeVoicesList>(REALTIME_METHODS.listVoices, {});
    console.log("v2 (default " + result.voices.defaultV2 + "):");
    console.log("  " + result.voices.v2.join(", "));
    console.log("v1 (default " + result.voices.defaultV1 + "):");
    console.log("  " + result.voices.v1.join(", "));
  } finally {
    await client.close();
  }
}

function lanAddress(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return null;
}

async function serve(args: Args): Promise<void> {
  const token = args.noToken ? undefined : args.token ?? randomBytes(16).toString("hex");

  const handle = await startRelay({
    port: args.port,
    host: args.host,
    cwd: args.cwd,
    voice: args.voice,
    model: args.model,
    sandbox: args.sandbox,
    token,
  });

  const query = token ? `/?token=${token}` : "/";
  console.log(`runny listening on http://${args.host}:${args.port}${query}`);
  console.log(`  repo:    ${args.cwd}`);
  console.log(`  sandbox: ${args.sandbox}`);
  const lan = lanAddress();
  if (lan) console.log(`  lan:     http://${lan}:${args.port}${query}`);
  if (!token) console.log("  warning: no token. Anyone who reaches this port can drive your repo.");
  console.log(`\nExpose it to your phone:  tailscale serve --bg ${args.port}`);

  const shutdown = () => {
    console.log("\nshutting down");
    void handle.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const args = parseArgs(process.argv.slice(2));

switch (args.command) {
  case "help":
    console.log(HELP);
    break;
  case "voices":
    await listVoices();
    break;
  case "serve":
    await serve(args);
    break;
  default:
    console.error(`unknown command: ${args.command}\n`);
    console.log(HELP);
    process.exit(1);
}
