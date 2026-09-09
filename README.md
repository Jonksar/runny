# runny

**Vibe code while running.**

Going outside was supposed to help.

Runny connects your phone's microphone and headphones to Codex voice. Codex hands coding work to a GPT-6 Astra thread on your computer and brings the results back into the conversation.

Audio travels directly over WebRTC. Your computer handles signaling and coding. Your ChatGPT login stays in Codex; Runny needs no OpenAI API key.

[Setup](#setup) · [Commands](#commands) · [How it works](docs/architecture.md) · [Protocol](docs/protocol.md) · [Test evidence](docs/testing.md)

An example request:

> "Find out why the login test is failing. Fix it, run the tests, and give me the short version."

Codex works in the chosen repository and reports back by voice. Review the changes when you return.

## Setup

Requires Node.js 22+, a recent Codex installation signed in with ChatGPT, and voice access on that account. Runny prefers the installed macOS desktop Codex binary, then falls back to `codex` on PATH. Use `--codex-bin` to select one explicitly.

```sh
npm install -g github:Jonksar/runny
```

From the repository you want Codex to work in:

```sh
runny doctor
runny
```

`doctor` checks login and protocol metadata without opening a model session. A passing check does not prove voice availability. Runny prints a local URL with an access token. Open it, allow the microphone, and tap **Start**. Tap **Stop** to end the session.

For a phone, expose the local port through your existing HTTPS tunnel. With Tailscale installed and both devices signed into your tailnet:

```sh
tailscale serve --bg 8765
```

Open the printed HTTPS address on your phone and append the `/#token=...` fragment printed by Runny. Keep the token private: it grants control of the chosen repository. The relay listens on localhost by default and accepts one controller at a time.

Keep the computer awake and connected. Use headphones and keep the phone page open. Screen wake lock is best effort. Safari background audio, a locked screen, cellular handovers, wind, and race-length reliability need testing on your own phone before the race.

## Commands

```sh
runny --cwd ~/my-project
runny --sandbox read-only
runny --model gpt-6-astra
runny --codex-bin /path/to/codex
runny voices
runny --help
```

| Option | Default | Purpose |
| --- | --- | --- |
| `--cwd` | Current directory | Coding workspace |
| `--model` | `gpt-6-astra` | Coding orchestrator, independent of voice model |
| `--voice` | Codex selection | Optional voice override |
| `--sandbox` | `workspace-write` | Also accepts `read-only` or `danger-full-access` |
| `--host` | `127.0.0.1` | Listen address |
| `--port` | `8765` | Listen port |
| `--token` | Random per launch | Override access token |
| `--codex-bin` | Desktop binary, then PATH | Select Codex installation |

Coding runs with interactive approvals disabled. The selected sandbox still applies, so commands requiring approval can fail. Runny refuses unexpected interactive requests. Use a dedicated checkout and inspect the resulting work locally. Codex controls task execution and any subagents; Runny does not add a second orchestration service.

## Cost and compatibility

Runny adds no paid relay service. Voice and coding remain subject to your account's access, limits, and credits. This is not a quota bypass or a promise of free usage. Choose a cheaper available coding model with `--model` when Astra is unnecessary. Stop the call when finished; Runny does not silently retry into another paid transport.

The implementation uses the experimental Codex app-server WebRTC v3 interface, tested with Codex **0.153.4**. Older builds may expose the same methods but use an obsolete voice model. `runny voices` lists metadata, not a guarantee that each voice works with v3.

This is a browser call to Codex. It does not inject audio into an already-open desktop voice call, integrate with ChatGPT mobile voice, or provide a telephone number. Those approaches motivated the project; the smaller direct WebRTC connection is implemented here.

## Tested so far

In a live test, a spoken request had Astra read a real file. The browser received and played the correct spoken answer. Automated tests cover the protocol, access controls, session cleanup, and browser audio in both directions. See [test evidence](docs/testing.md).

A physical iPhone, locked screen, cellular handovers, and a full race remain unverified.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Microphone blocked | Use HTTPS on the phone, allow microphone access, and check browser permissions. Localhost works on the computer. |
| Relay connection failed | Check tunnel, token, and whether another controller is still connected or shutting down. |
| Voice model/version error | Select a recent Codex binary with `--codex-bin`; retry a short call. |
| Start returns but no voice | Runny waits for the SDP answer and a connected audio peer. Read the displayed error; metadata alone does not prove access. |
| Coding does not proceed | Check account limits, the chosen model, sandbox restrictions, and the task in Codex. |
| Disconnect | Tap Start to open a new conversation. Runny does not replay instructions or resume a disconnected coding task. |

## Development

```sh
npm ci
npm test
npm run typecheck
npx playwright install chromium
npm run test:browser
```

The normal suite and local browser test need no login or model credits. The browser test uses a real local WebRTC peer with synthetic audio. `RUNNY_BROWSER_CHANNEL=chrome npm run test:browser` uses an installed Chrome instead of downloading Chromium.

The package exports `startRelay`, `RealtimeSession`, `AppServerClient`, diagnostics, and signaling types. See [protocol and API](docs/protocol.md). Version 0.2 replaces the 0.1 PCM transport with WebRTC; binary audio frames and API-key options were removed.

MIT licensed. Inspired by [Codex](https://github.com/openai/codex), [Happy](https://github.com/slopus/happy), and [duck_talk](https://github.com/dhuynh95/duck_talk). Documentation structure takes cues from [Hermes Agent](https://github.com/NousResearch/hermes-agent).
