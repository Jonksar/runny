# runny

Vibe code while running.

`runny` puts your phone's microphone in front of the Codex realtime voice agent, so you can talk to a coding agent working in a real repository while you are outdoors, at pace, with the phone locked in an armband.

You talk. It delegates to the coding agent. It tells you what happened in two sentences. You keep running.

## Why this exists

Codex already ships the hard part. Its realtime voice layer handles the model connection, reconnect backoff, transcript reconciliation, and the handoff to the coding agent that does the real work. What it does not do is reach your phone, because its audio is bound to your Mac's microphone and speakers.

That is the entire gap `runny` fills. It is a relay, not a voice agent.

```
 iPhone browser                 your Mac
 mic + speaker  ──wss──▶  runny relay  ──JSON-RPC──▶  codex app-server
                                                          │
                                                     coding agent
                                                     in your repo
```

No virtual audio device, no BlackHole, no telephony, no per-minute API billing. Audio moves as PCM over a WebSocket into `thread/realtime/appendAudio`, and comes back out of `thread/realtime/outputAudio/delta`.

## Requirements

- Node 22 or newer
- `codex` CLI on your `PATH`, logged in (`codex login`)
- A Codex plan with quota remaining. Check with `codex` or the rate limit endpoint; realtime sessions draw on the same weekly allowance as everything else.

The realtime feature is behind a flag that is off by default. `runny` passes `--enable realtime_conversation` for you, so you do not need to change your `config.toml`.

## Quick start

```bash
npm install
npm run build
node dist/cli.js serve --cwd /path/to/your/repo
```

It prints a URL with a generated token. Open that on your phone, tap **Start**, grant the microphone, and talk.

Check your account's voices first if you want a different one:

```bash
node dist/cli.js voices
```

## Getting it to your phone

The relay binds to localhost. To reach it from a phone on cellular you need a tunnel, and it must be HTTPS, because iOS refuses `getUserMedia` and cleartext WebSockets on non-private addresses.

Tailscale is the least painful option. It needs no third party and issues a real certificate:

```bash
tailscale serve --bg 8765
```

Then open the `https://<machine>.<tailnet>.ts.net` address it prints, with `?token=...` appended.

If you would rather not run a token, `--no-token` leans entirely on the tunnel's network identity for access control. That is a defensible choice behind Tailscale and a bad one anywhere else.

## Safety

The agent runs unattended while you are running. You cannot read a diff or tap approve at 4:30 per kilometre, so two things do the work a human normally would:

- **The sandbox.** Defaults to `workspace-write`. It is the only thing between a misheard sentence and your working tree. `--sandbox read-only` is a reasonable way to start.
- **The token.** Without it, anyone who can reach the port can drive a coding agent inside your repository.

Point `--cwd` at a git worktree rather than your main checkout, and review everything at the finish line.

## Options

```
runny serve [options]     Start the relay and serve the phone client
runny voices              List the voices your account can use

--port <n>        Port to listen on (default 8765)
--host <addr>     Bind address (default 127.0.0.1)
--cwd <path>      Repository the agent works in
--voice <name>    Voice to speak with (default marin)
--model <name>    Model for the coding agent
--sandbox <mode>  read-only | workspace-write | danger-full-access
--token <secret>  Require ?token=<secret> on the socket
--no-token        Run without a token. Only safe behind Tailscale.
```

## Known limits

**iOS suspends audio when Safari goes to the background.** This is the big one. Adding the page to your home screen helps, and audio playback keeps the context alive longer than you would expect, but a locked phone in a pocket will eventually stop capturing. Until there is a native client with CallKit, treat screen-on as a requirement and plan for at least one reconnect during a long run.

**Realtime is an experimental Codex feature.** `realtime_conversation` is marked under development. The method names here were read out of `codex-cli 0.149.1` and verified live. They can change.

**Quota is shared.** A realtime session spends from the same weekly allowance as your normal Codex usage. Check before a run you care about.

**Twenty exchanges, not two hundred.** A 10k gives you maybe twenty useful spoken turns. Queue the real work before you leave. Mid-run you are triaging and dictating, not reviewing code.

## Development

```bash
npm run build      # compile to dist/
npm test           # build, then run the suite
npm run typecheck  # types only
```

Tests run against the built output, so they exercise what actually ships. `test/fake-codex.js` stands in for `codex app-server`, which means the suite needs no account, no quota, and no network.

## Layout

| Path | What it does |
|---|---|
| `src/appserver.ts` | Newline-delimited JSON-RPC client for `codex app-server` |
| `src/session.ts` | One realtime conversation bound to one Codex thread |
| `src/relay.ts` | WebSocket server and static host for the phone client |
| `src/audio.ts` | PCM conversion and resampling |
| `src/protocol.ts` | Wire protocol between phone and relay |
| `src/types.ts` | Codex realtime protocol types |
| `web/index.html` | The phone client |

## Two details that cost an afternoon

If you build something similar, these are the two that will bite you.

Realtime methods need `--enable realtime_conversation`, because the feature is off by default. And `initialize` must declare `"capabilities": {"experimentalApi": true}`, or every realtime call returns `-32600 requires experimentalApi capability`. Neither is documented in `codex --help`.

## License

MIT
