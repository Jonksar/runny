<h1 align="center">runny</h1>

<p align="center"><strong>Vibe code while running.</strong></p>

<p align="center">
  <a href="https://github.com/Jonksar/runny/actions/workflows/ci.yml"><img alt="ci" src="https://github.com/Jonksar/runny/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg">
  <img alt="status" src="https://img.shields.io/badge/status-experimental-orange.svg">
</p>

`runny` puts your phone's microphone in front of the Codex realtime voice agent, so you can talk to a coding agent working in a real repository while you are outdoors at pace, phone locked in an armband.

You talk. It delegates to the coding agent. It tells you what happened in two sentences. You keep running.

```
 iPhone browser                  your Mac
 mic + speaker  ──wss──▶  runny relay  ──JSON-RPC──▶  codex app-server
                                                           │
                                                      coding agent
                                                      in your repo
```

No API key, no per-minute billing, no telephony, no virtual audio device. It rides the Codex plan you already pay for.

## Why it is small

Codex already ships the hard part. Its realtime layer owns the model connection, reconnect backoff, transcript reconciliation, and handoff to the coding agent that does the real work. What it cannot do is reach your phone, because its audio is bound to your Mac's own microphone and speakers.

That gap is the whole project. `runny` is a relay, not a voice agent, and it stays near 1,100 lines because of it.

| | |
|---|---|
| **Rides your Codex plan** | Authenticates through `codex login`. No OpenAI API key and no per-minute charge. |
| **Real audio, not telephony** | PCM16 over a WebSocket into `appendAudio`, back out of `outputAudio/delta`. Wideband, not 8kHz phone audio. |
| **Sandboxed by default** | `workspace-write`. You cannot tap approve at race pace, so the sandbox does that job. |
| **Pre-flight checks** | `runny doctor` catches an exhausted quota before you are three kilometres from the house. |
| **No build step to use** | One command from a fresh machine. It compiles itself on install. |
| **Testable without an account** | The suite runs against a fake app-server. No quota, no network. |

## Install

One command, from nothing:

```bash
npx github:Jonksar/runny doctor
```

That clones, installs, compiles, and runs the pre-flight check. If you want it on your `PATH`:

```bash
npm install -g github:Jonksar/runny
```

From a clone:

```bash
git clone https://github.com/Jonksar/runny && cd runny && npm install && npm test
```

**Prerequisites.** Node 22 or newer, and the [Codex CLI](https://developers.openai.com/codex/cli) on your `PATH` and signed in. Run `runny doctor` and it will tell you what is missing.

## Quickstart

```bash
runny doctor                        # verify codex, auth, realtime, quota
runny serve --cwd ~/code/my-project # start the relay
tailscale serve --bg 8765           # expose it over HTTPS
```

Open the printed URL on your phone with `?token=...` appended, tap **Start**, grant the microphone, and talk.

```
runny 0.1.0
  repo     /Users/you/code/my-project
  sandbox  workspace-write
  local    http://127.0.0.1:8765/?token=8f3c1a...
  lan      http://192.168.1.103:8765/?token=8f3c1a...
```

## Reaching your phone

The relay binds to localhost. Cellular needs a tunnel, and it has to terminate TLS: iOS refuses `getUserMedia` and cleartext WebSockets on non-private addresses, so plain `http://` over the LAN will fail on the phone even though it works on your laptop.

Tailscale is the least painful option because it needs no third party and issues a real certificate.

```bash
tailscale serve --bg 8765
```

Anything else that gives you HTTPS works too. Cloudflare quick tunnels and ngrok both do.

## Commands

| Command | What it does |
|---|---|
| `runny` / `runny serve` | Start the relay and serve the phone client |
| `runny doctor` | Check node, codex, auth, realtime, and quota. Exits non-zero if blocked. |
| `runny voices` | List the voices your account can use |

## Options

| Flag | Default | Notes |
|---|---|---|
| `--cwd <path>` | current dir | Repository the agent works in. Point it at a worktree. |
| `--port <n>` | `8765` | |
| `--host <addr>` | `127.0.0.1` | Widen only if you know why. |
| `--voice <name>` | `marin` | `runny voices` lists what your account has. |
| `--model <name>` | plan default | Useful when your main quota is spent. |
| `--sandbox <mode>` | `workspace-write` | `read-only`, `workspace-write`, `danger-full-access` |
| `--token <secret>` | generated | Required as `?token=` on the socket. |
| `--no-token` | off | Leans entirely on the tunnel for access control. |
| `--codex-bin <path>` | `codex` on PATH | Point at a specific Codex build. |

## Safety

The agent runs unattended while you run. You cannot read a diff or tap approve at 4:30 per kilometre, so two things do the job a human normally would.

**The sandbox** is the only thing between a misheard sentence and your working tree. It defaults to `workspace-write`. Starting with `--sandbox read-only` for your first run is a reasonable way to build trust.

**The token** is generated per run and required on the socket. Without it, anyone who reaches the port drives a coding agent inside your repository. `--no-token` is defensible behind Tailscale and a bad idea anywhere else.

Point `--cwd` at a git worktree rather than your main checkout, and review everything at the finish line.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `-32600 requires experimentalApi capability` | `initialize` did not declare the capability | `runny` handles this. If you are writing your own client, see [docs/protocol.md](docs/protocol.md). |
| `method not found: thread/realtime/*` | Feature flag off | `runny` passes `--enable realtime_conversation`. Your `codex` may predate the feature. |
| Session fails to start, relay looks fine | Quota exhausted | `runny doctor`. Realtime draws on the same weekly allowance as everything else. |
| Microphone blocked on the phone | Page is not HTTPS | iOS requires TLS for `getUserMedia` off private addresses. Use `tailscale serve`. |
| Audio stops when you pocket the phone | iOS suspended the tab | Known limit, see below. |
| Works on laptop, dead on phone | Bound to `127.0.0.1` | Tunnel it. Do not widen `--host` to reach a phone. |

## Known limits

**iOS suspends audio when Safari backgrounds.** This is the real one. Installing to the home screen helps, and active playback keeps the context alive longer than you would expect, but a locked phone in a pocket eventually stops capturing. Treat screen-on as a requirement and expect at least one reconnect on a long run. Fixing it properly means a native client with CallKit, which is a different project.

**Realtime is experimental in Codex.** `realtime_conversation` is marked under development. The method names here were read out of `codex-cli 0.149.1` and verified against a live session. They can change.

**Quota is shared.** A realtime session spends the same weekly allowance as ordinary Codex usage. Check before a run you care about.

**Twenty exchanges, not two hundred.** A 10k gives you roughly twenty useful spoken turns. Queue the real work before you leave. Mid-run you are triaging and dictating, not reviewing code.

## Documentation

| Document | Covers |
|---|---|
| [docs/protocol.md](docs/protocol.md) | Codex realtime app-server methods, payload shapes, the two undocumented requirements |
| [docs/architecture.md](docs/architecture.md) | Module layout, audio path, resampling, what runs where |

## Development

```bash
npm run build      # compile to dist/
npm test           # build, then run the suite
npm run typecheck  # types only
```

Tests run against the built output, so they exercise what ships. `test/fake-codex.js` stands in for `codex app-server`, which is why the suite needs no account, no quota, and no network.

## License

MIT
