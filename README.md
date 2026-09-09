<h1 align="center">runny</h1>

<p align="center"><strong>Vibe code while running.</strong></p>

<p align="center">
  <a href="https://github.com/Jonksar/runny/actions/workflows/ci.yml"><img alt="ci" src="https://github.com/Jonksar/runny/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg">
  <img alt="status" src="https://img.shields.io/badge/status-experimental-orange.svg">
  <img alt="pace" src="https://img.shields.io/badge/tested%20at-4%3A30%2Fkm-ff69b4.svg">
</p>

`runny` puts your phone's microphone in front of the Codex realtime voice agent, so you can talk to a coding agent working in a real repository while you are outdoors, at pace, with the phone locked in an armband.

You talk. It delegates to the coding agent. It tells you what happened in two sentences. You keep running, slightly worse than you would have.

```
 iPhone browser                  your Mac
 mic + speaker  ──wss──▶  runny relay  ──JSON-RPC──▶  codex app-server
                                                           │
                                                      coding agent
                                                      in your repo
```

## Should you use this

Almost certainly not. There is a well-known diagnostic in endurance training called the **talk test**: if you can hold a conversation, you are running easy. So the honest framing is that `runny` works beautifully on a recovery jog and gets structurally harder the more seriously you are racing. At threshold you will produce one word per exhale, and the transcript will read like a ransom note.

Use it on easy miles. Use it on the commute. Use it while walking the dog, where it is frankly excellent and nobody has to know.

## Why it is small

Codex already ships the hard part. Its realtime layer owns the model connection, reconnect backoff, transcript reconciliation, and the handoff to the coding agent that does the real work. What it cannot do is reach your phone, because its audio is wired to your Mac's own microphone and speakers, which are at home, on your desk, not with you.

That gap is the whole project. `runny` is a relay, not a voice agent, and it stays near 1,200 lines because of it.

| | |
|---|---|
| **Real audio, not telephony** | PCM16 over a WebSocket into `appendAudio`, back out of `outputAudio/delta`. Wideband, not the 8kHz mush a phone call would give you. |
| **Sandboxed by default** | `workspace-write`. You cannot tap approve at race pace, so the sandbox is doing a job normally reserved for a conscious adult. |
| **Pre-flight checks** | `runny doctor` catches the things that would otherwise ruin a run, three kilometres from home, with no way to fix them. |
| **No build step to use** | One command from a fresh machine. It compiles itself on install. |
| **Testable without an account** | The suite runs against a fake app-server. No key, no quota, no network. |

## Requirements

Three things, and the third is the one that will get you.

- **Node 22 or newer.**
- **The [Codex CLI](https://developers.openai.com/codex/cli)** on your `PATH`, signed in.
- **An OpenAI API key** in `OPENAI_API_KEY`.

That last one is not optional and not what you would guess. Codex itself runs fine on your ChatGPT plan, and `runny voices` will cheerfully answer using it, which makes everything look ready. But opening an actual realtime conversation returns:

```
thread/realtime/error  realtime conversation requires API key auth
```

It arrives a few seconds *after* a successful `start`, so it presents as a hang rather than an auth failure. Your ChatGPT subscription and your platform API billing are different wallets, and realtime only accepts the second one. `runny doctor` checks this so you find out indoors.

## Install

One command, from nothing:

```bash
npx github:Jonksar/runny doctor
```

That clones, installs, compiles, and tells you what is missing. To keep it around:

```bash
npm install -g github:Jonksar/runny
```

From a clone:

```bash
git clone https://github.com/Jonksar/runny && cd runny && npm install && npm test
```

## Quickstart

```bash
export OPENAI_API_KEY=sk-...
runny doctor                        # confirm everything before you put shoes on
runny serve --cwd ~/code/my-project
```

```
runny 0.1.0
  repo     /Users/you/code/my-project
  sandbox  workspace-write
  local    http://127.0.0.1:8765/?token=8f3c1a...
```

Now get that URL onto your phone, which is its own adventure.

## Testing it from your iPhone

The relay binds to localhost, and iOS will not give a web page a microphone unless the page is HTTPS. Typing your Mac's LAN address into Safari therefore fails in a way that looks like a `runny` bug and is not: no certificate, no microphone, no exceptions, not even on your own network.

So you need a tunnel that terminates TLS. Pick one.

**cloudflared** is the fastest way to test, because it needs no account and no login.

```bash
brew install cloudflared
runny serve --cwd ~/code/my-project          # note the token it prints
cloudflared tunnel --url http://localhost:8765
```

It prints a `https://something-random.trycloudflare.com` URL. Open that on your phone with `/?token=...` appended. Random subdomain, so treat the token as the only thing protecting your repo, because it is.

**Tailscale** is what you want for regular use. Stable hostname, real certificate, and your phone is already on the network.

```bash
brew install tailscale   # or the App Store app
tailscale serve --bg 8765
```

Then open the `https://<machine>.<tailnet>.ts.net/?token=...` it gives you.

**What a working run looks like.** Tap Start, grant the microphone once, and the status line moves through `listening` to `thinking` to `speaking`. Say something small first, like asking what files are in the repo. If you get audio back, the whole path works and you can go outside.

**If it fails, in likely order.** No microphone prompt means the page is not HTTPS. A prompt but no audio back means check the terminal, which is where the real error lands. Audio that stops the moment you lock the phone is iOS suspending Safari, which is expected and covered below.

## Commands

| Command | What it does |
|---|---|
| `runny` / `runny serve` | Start the relay and serve the phone client |
| `runny doctor` | Check node, codex, auth, API key, realtime, and quota. Exits non-zero if blocked. |
| `runny voices` | List the voices your account can use |

## Options

| Flag | Default | Notes |
|---|---|---|
| `--cwd <path>` | current dir | Repository the agent works in. Point it at a worktree. |
| `--port <n>` | `8765` | |
| `--host <addr>` | `127.0.0.1` | Widen only if you know why. Tunnelling is not a reason. |
| `--voice <name>` | `marin` | `runny voices` lists what your account has. |
| `--model <name>` | plan default | Useful when your main quota is spent. |
| `--sandbox <mode>` | `workspace-write` | `read-only`, `workspace-write`, `danger-full-access` |
| `--token <secret>` | generated | Required as `?token=` on the socket. |
| `--no-token` | off | Leans entirely on the tunnel for access control. |
| `--codex-bin <path>` | `codex` on PATH | Point at a specific Codex build. |
| `--api-key <key>` | `$OPENAI_API_KEY` | Required. See Requirements. |

## Safety

You are about to leave a coding agent unsupervised in a repository while you are physically elsewhere and out of breath. Two things stand in for the judgement you normally apply.

**The sandbox** is the only thing between a misheard sentence and your working tree. Wind noise plus heavy breathing plus a speech model is not a combination that inspires confidence, and "delete the old tests" and "delete the whole test suite" are four syllables apart. Start on `--sandbox read-only` until you trust it.

**The token** is generated per run. Without it, anyone who reaches that URL is driving a coding agent inside your repository. `--no-token` is defensible behind Tailscale and reckless on a public tunnel.

Point `--cwd` at a git worktree, not your main checkout, and review everything at the finish line while you still have adrenaline to soften the blow.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Session starts, then dies a few seconds later | ChatGPT auth. Realtime needs an API key. | Set `OPENAI_API_KEY`. See Requirements. |
| `-32600 requires experimentalApi capability` | `initialize` did not declare it | `runny` handles this. Writing your own client? See [docs/protocol.md](docs/protocol.md). |
| `invalid type: string "websocket"` | `transport` is a tagged enum, not a string | `{ "type": "websocket" }`, plus top-level `outputModality`. |
| `method not found: thread/realtime/*` | Feature flag off | `runny` passes `--enable realtime_conversation`. Your `codex` may predate it. |
| No microphone prompt on the phone | Page is not HTTPS | iOS requires TLS off private addresses. Tunnel it. |
| Audio stops when you pocket the phone | iOS suspended the tab | Known limit, see below. |
| Works on laptop, dead on phone | Bound to `127.0.0.1` | Tunnel it. Do not widen `--host`. |

## Known limits

**iOS suspends audio when Safari backgrounds.** This is the real one. Home-screen install helps and active playback buys you longer than you would expect, but a locked phone in a pocket eventually stops capturing. Treat screen-on as a requirement and expect a reconnect on a long run. Fixing it properly needs a native client with CallKit, which is a different project and a worse hobby.

**Realtime is experimental in Codex.** `realtime_conversation` is marked under development. Method names here were read out of `codex-cli 0.149.1` and verified against a live session. They can change without warning, and did once already while this README was being written.

**Twenty exchanges, not two hundred.** A 10k gives you roughly twenty useful spoken turns. Queue the real work before you leave. Mid-run you are triaging and dictating, not reviewing code, and certainly not refactoring.

**It will make you slower.** Not much. But talking costs oxygen, and oxygen was going somewhere.

## Documentation

| Document | Covers |
|---|---|
| [docs/protocol.md](docs/protocol.md) | Codex realtime app-server methods, payload shapes, the undocumented requirements |
| [docs/architecture.md](docs/architecture.md) | Module layout, audio path, resampling, what runs where |

## Development

```bash
npm run build      # compile to dist/
npm test           # build, then run the suite
npm run typecheck  # types only
```

Tests run against the built output, so they exercise what ships. `test/fake-codex.js` stands in for `codex app-server`, which is why the suite needs no key, no quota, and no network. It is also the only part of this project that has never been outside.

## License

MIT
