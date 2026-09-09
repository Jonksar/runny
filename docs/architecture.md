# Architecture

```text
Phone browser  <======= WebRTC audio =======>  Codex voice service
      |                                               |
      | authenticated WebSocket signaling             | coding handoff
      v                                               v
Runny relay  <======= stdio JSON-RPC =======>  Codex app-server
                                                   |
                                           GPT-6 Astra thread
                                                   |
                                             Local repository
```

The browser adds its microphone track and `oai-events` channel, then produces an SDP offer. Runny creates a coding thread and asks Codex to open WebRTC v3. Codex authenticates and returns an SDP answer. Audio travels directly to the voice service. Runny never resamples audio or reads Codex login files.

Codex owns the voice model, coding tools, handoff and subagents. `--model` selects only the coding orchestrator. Runny defaults to `gpt-6-astra` and leaves the voice model at Codex's compatible default. Start instructions request brief spoken replies grounded in actual coding results. Runny selects Codex's `bemTags` handoff mode so completed coding responses use the speakable channel, rather than remaining silent context.

## Requirements and decisions

The original request was hands-free coding during a 10k, Astra orchestration, price awareness, existing ChatGPT/Codex voice, bidirectional audio, open-source delivery, one-command installation, dense documentation and minimal paid testing.

| Approach | Implementation and maintenance | Decision |
| --- | --- | --- |
| Browser WebRTC + Codex signaling | Least custom code. Browser handles codecs, echo cancellation and jitter. Easiest to implement and maintain. | Implemented |
| Telephone audio into a virtual desktop microphone | Requires call transport, virtual devices, app routing and echo management. | Not implemented |
| Telephone/SIP bridge | Adds a provider, number, call billing and media/auth integration. | Not implemented |
| PCM/WebSocket relay | Requires audio conversion, buffers and separate API-key transport. | Removed in 0.2 |
| ChatGPT mobile voice | No supported integration established for this local project. | Not claimed |

The browser is the implemented phone endpoint, using headphones and one Start/Stop control. PSTN calling and guaranteed lock-screen operation are not included. Check actual phone behavior before the race.

## Components

- `appserver.ts`: child process, JSON-RPC correlation, deadlines and unexpected interactive requests.
- `session.ts`: coding thread, asynchronous SDP/errors, cancellation and teardown.
- `relay.ts`: fixed public assets, bounded signaling and one authenticated controller until cleanup finishes.
- `protocol.ts`: signaling validation.
- `web/client.js`: microphone, peer, audio playback, transcripts and wake lock.
- `doctor.ts`: account/protocol metadata without opening voice.

No new account, hosted database, credential store, telephone provider or agent framework is needed.

## Lifetime

A successful start response is acknowledgement only. The relay waits for SDP; the browser waits for peer connection and data-channel opening. Later service errors remain fatal. There is no automatic paid-transport fallback.

Stop, page exit, signaling loss and relay shutdown close the child process. Ping/pong catches an unreachable phone. Audio disconnects get a short recovery window. A new Start creates a fresh coding thread; instructions are never automatically replayed. Recover unfinished work from local Codex history before restarting it.

## References

- [Codex 0.153.4 realtime implementation](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/realtime_conversation.rs) defines transport auth, v3 headers and defaults.
- [Codex browser integration](https://github.com/openai/codex/blob/ff29a44391deccde0aba0f8390337d7f3c319ea4/codex-rs/app-server/README.md) specifies negotiation and notifications.
- [Happy voice architecture](https://github.com/slopus/happy/blob/ac64b9b4677870f7b7a9eacfd0780959229717f1/docs/voice-architecture.md) separates voice interaction from coding work.
- [duck_talk connection handling](https://github.com/dhuynh95/duck_talk/blob/fdf4835e71a084b9dccaf09d014d121dde77a9ab/server/reach.ts) illustrates private HTTPS access to a local service.

These informed the design without adding their frameworks or copying their protocols.
