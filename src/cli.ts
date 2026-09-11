#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { startRelay, type RelayOptions } from "./relay.js";
import { AppServerClient } from "./appserver.js";
import { diagnose, renderChecks } from "./doctor.js";
import { tailscaleLink } from "./phone.js";
import { DEFAULT_MODEL } from "./session.js";
import { REALTIME_METHODS, type RealtimeVoicesList } from "./types.js";
const VERSION = "0.2.0";
const HELP = `runny ${VERSION} - talk to Codex from your phone

Usage: runny [serve | doctor | voices] [options]

  --cwd <path>       Working repository, defaults to current directory
  --model <name>     Coding orchestrator, defaults to ${DEFAULT_MODEL}
  --voice <name>     Optional voice override, defaults to Codex selection
  --sandbox <mode>   read-only | workspace-write | danger-full-access
                     Defaults to workspace-write, interactive approvals disabled
  --port <number>    Listen port, defaults to 8765
  --host <address>   Bind address, defaults to 127.0.0.1
  --token <secret>   Shared access token, randomly generated when omitted
  --codex-bin <path> Codex executable, prefers installed macOS desktop binary
  -h, --help        Show help
  -v, --version     Show version

Install: npm install -g github:Jonksar/runny
Phone: runny prints a Tailscale link. Run tailscale serve --bg 8765 once if asked.
ChatGPT login stays in Codex. Runny does not need an OpenAI API key.
Doctor reads metadata only; it does not confirm live voice access.
`;

async function main(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(VERSION);
    return;
  }
  const args: RelayOptions = {
    port: 8765,
    host: "127.0.0.1",
    cwd: process.cwd(),
    sandbox: "workspace-write",
    model: DEFAULT_MODEL,
  };
  const command = argv[0] && !argv[0].startsWith("-") ? argv.shift() : "serve";
  if (!["serve", "doctor", "voices"].includes(command!))
    throw new Error(`Unknown command: ${command}`);
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${flag}`);
    switch (flag) {
      case "--cwd":
        args.cwd = resolve(value);
        break;
      case "--port":
        args.port = Number(value);
        break;
      case "--host":
        args.host = value;
        break;
      case "--model":
        args.model = value;
        break;
      case "--voice":
        args.voice = value;
        break;
      case "--token":
        args.token = value;
        break;
      case "--codex-bin":
        args.bin = value;
        break;
      case "--sandbox":
        if (
          !["read-only", "workspace-write", "danger-full-access"].includes(
            value,
          )
        )
          throw new Error("Invalid sandbox");
        args.sandbox = value as RelayOptions["sandbox"];
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535)
    throw new Error("Port must be an integer from 1 to 65535");
  if (!(await stat(args.cwd)).isDirectory())
    throw new Error("Working directory must be a directory");
  if (command === "doctor") {
    const checks = await diagnose(args);
    console.log(renderChecks(checks));
    if (checks.some((c) => !c.ok && !c.warning)) process.exitCode = 1;
    return;
  }
  if (command === "voices") {
    const client = await AppServerClient.start(args);
    try {
      const { voices } = await client.request<RealtimeVoicesList>(
        REALTIME_METHODS.listVoices,
        {},
      );
      console.log(
        `Codex voice metadata\nv1: ${voices.v1.join(", ")}\nv2: ${voices.v2.join(", ")}\nRunny uses v3 with the Codex default unless --voice is set.`,
      );
    } finally {
      await client.close();
    }
    return;
  }
  args.token ??= randomBytes(24).toString("hex");
  const handle = await startRelay(args);
  const hostname = args.host.includes(":") ? `[${args.host}]` : args.host;
  console.log(
    `runny ${VERSION}\nRepository: ${args.cwd}\nCoding model: ${args.model}\nSandbox: ${args.sandbox}`,
  );
  console.log(
    `Open: http://${hostname}:${args.port}/#token=${encodeURIComponent(args.token)}`,
  );
  const phone = await tailscaleLink(args.port, args.token);
  if (!phone)
    console.log(
      `Phone: install Tailscale, run tailscale serve --bg ${args.port}, then open its HTTPS URL with /#token=${encodeURIComponent(args.token)}`,
    );
  else if (phone.served) console.log(`Phone: ${phone.url}`);
  else
    console.log(
      `Phone: run tailscale serve --bg ${args.port} once, then open ${phone.url}`,
    );
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void handle.close().catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
void main(process.argv.slice(2)).catch((err) => {
  console.error(`runny: ${err.message}`);
  process.exitCode = 1;
});
