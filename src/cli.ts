#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { startRelay } from "./relay.js";
import { AppServerClient } from "./appserver.js";
import { diagnose, renderChecks } from "./doctor.js";
import { REALTIME_METHODS, type RealtimeVoice, type RealtimeVoicesList } from "./types.js";
import type { SandboxMode } from "./session.js";

const VERSION = "0.1.0";

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
  bin?: string;
  apiKey?: string;
}

const HELP = `runny ${VERSION} - vibe code while running

USAGE
  runny [serve] [options]   Start the relay and serve the phone client
  runny doctor              Check everything a run needs before you leave
  runny voices              List the voices your account can use

OPTIONS
  --cwd <path>      Repository the agent works in     (default: current dir)
  --port <n>        Port to listen on                 (default: 8765)
  --host <addr>     Bind address                      (default: 127.0.0.1)
  --voice <name>    Voice to speak with               (default: marin)
  --model <name>    Model for the coding agent
  --sandbox <mode>  read-only | workspace-write | danger-full-access
                                                      (default: workspace-write)
  --token <secret>  Require ?token=<secret> on the socket
  --no-token        Skip the token. Only safe behind Tailscale.
  --codex-bin <p>   Path to the codex binary          (default: codex on PATH)
  --api-key <key>   OpenAI API key                    (default: $OPENAI_API_KEY)
                    Required. Realtime refuses ChatGPT auth.
  -h, --help        This text
  -v, --version     Print the version

REACHING YOUR PHONE
  tailscale serve --bg 8765

  iOS refuses microphone access and cleartext sockets on non-private
  addresses, so the tunnel has to terminate TLS. Tailscale issues a real
  certificate and needs no third party.
`;

function parseArgs(argv: string[]): Args {
  const first = argv[0];
  const args: Args = {
    command: first && !first.startsWith("-") ? first : "serve",
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
      case "--codex-bin": if (next) { args.bin = next; i++; } break;
      case "--api-key": if (next) { args.apiKey = next; i++; } break;
      case "--help": case "-h": args.command = "help"; break;
      case "--version": case "-v": args.command = "version"; break;
    }
  }
  return args;
}

async function listVoices(): Promise<void> {
  const client = await AppServerClient.start();
  try {
    const { voices } = await client.request<RealtimeVoicesList>(REALTIME_METHODS.listVoices, {});
    console.log(`v2  (default ${voices.defaultV2})\n  ${voices.v2.join(", ")}`);
    console.log(`v1  (default ${voices.defaultV1})\n  ${voices.v1.join(", ")}`);
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
  const handle = await startRelay({ ...args, token });
  const path = token ? `/?token=${token}` : "/";

  console.log(`runny ${VERSION}`);
  console.log(`  repo     ${args.cwd}`);
  console.log(`  sandbox  ${args.sandbox}`);
  console.log(`  local    http://${args.host}:${args.port}${path}`);
  const lan = lanAddress();
  if (lan) console.log(`  lan      http://${lan}:${args.port}${path}`);
  if (!token) console.log("  warning  no token: anyone reaching this port can drive your repo");
  console.log(`\n  tailscale serve --bg ${args.port}   # then open that URL${path} on your phone`);

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
  case "version":
    console.log(VERSION);
    break;
  case "doctor": {
    const checks = await diagnose();
    console.log(renderChecks(checks));
    process.exit(checks.some((c) => !c.ok && !c.warning) ? 1 : 0);
    break;
  }
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
