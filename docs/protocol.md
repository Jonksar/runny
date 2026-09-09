# Protocol and API

Experimental Codex app-server WebRTC, verified against 0.153.4. Node.js 22+.

## Package API

```ts
import { startRelay } from 'runny';
const relay = await startRelay({
  host: '127.0.0.1', port: 8765, cwd: '/path/to/repository',
  model: 'gpt-6-astra', sandbox: 'workspace-write',
  token: process.env.RUNNY_TOKEN,
});
await relay.close();
```

The CLI generates a token by default. The library permits tokenless loopback listeners for embedding; other bind addresses require a token. Always use authentication when tunneling. `close()` is idempotent and waits for owned processes and sockets.

`RealtimeSession.open({sdp, cwd, bin?, model?, voice?, sandbox?, signal?, startupTimeoutMs?})` returns a session with `threadId` and answer `sdp`. Subscribe to `fault` for later failures. Always call `close()`. An answer does not prove media readiness.

`AppServerClient.start({bin?, cwd?, features?, requestTimeoutMs?})` opens stdio. `request(method, params)` has a 30-second default deadline. `notify(method, params)` needs no reply. Unknown interactive requests receive an error instead of implicit approval. `diagnose(options)` returns metadata checks without opening voice.

## Signaling

Connect to `/?token=...`. The browser gets the token from its URL fragment and attaches it only to the socket. Browser origins must match the requested host. One controller is admitted, including during old-process cleanup. Frames are capped at 70,000 bytes.

```json
{"type":"hello","sdp":"v=0\r\n..."}
{"type":"text","text":"Run the tests."}
{"type":"bye"}
```

Offers are limited to 65,536 characters, text to 8,192. Duplicate hello messages on the same socket are ignored. Invalid messages and binary PCM frames are rejected. `text` forwards to Codex `appendText`; it is not a guaranteed spoken user turn.

```json
{"type":"answer","threadId":"...","sdp":"v=0\r\n..."}
{"type":"error","message":"..."}
```

There is no relay ready event. Apply the answer to the peer, then wait for peer `connected` and data-channel `open`. Audio stays on WebRTC. Failures remain visible after cleanup.

## Codex

Run with `--enable realtime_conversation app-server`, initialize with `experimentalApi: true`, then create the backing coding thread:

```json
{"method":"thread/start","params":{"cwd":"/path/to/repo","model":"gpt-6-astra","sandbox":"workspace-write","approvalPolicy":"never"}}
```

Use `thread.id` in the next request:

```json
{"method":"thread/realtime/start","params":{"threadId":"...","transport":{"type":"webrtc","sdp":"v=0\r\n..."},"version":"v3","outputModality":"audio"}}
```

Runny also supplies short instructions to the backend coding model, including `[COMMENTARY]` progress and `[FINAL]` result prefixes. These keep progress on the commentary channel and final results on the speakable channel. Voice defaults and automatic handoffs remain managed by Codex. Runny sets `codexResponseHandoffMode: "bemTags"`: completed final responses go to the speakable channel. The default `thinking` mode can leave completed results silent.

Start returns `{}` before `thread/realtime/started` and `thread/realtime/sdp`. Errors or closure can follow anytime. WebRTC uses Codex's ChatGPT authentication; the removed WebSocket audio transport required an API key.

Both 0.149.1 and 0.153.4 expose the explicit version field, but older default voice models differ. A voice-validation rejection does not prove authentication succeeded. Only a live connection establishes that the tested account can connect.
