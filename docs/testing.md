# Verification

Run the free checks from a clean checkout:

```sh
npm ci
npm test
npm run typecheck
npx playwright install chromium
npm run test:browser
```

`RUNNY_BROWSER_CHANNEL=chrome` selects an installed Chrome. Browser tests use synthetic media and a real local WebRTC peer. The Codex executable is a boundary fake, so no credentials, provider calls or model tokens are needed.

## Automated coverage

26 public-interface tests, typechecking, and the browser test passed locally. Installation from the packed release and package imports also passed.

Public CLI, package and socket tests exercise SDP negotiation, late errors, startup cancellation, process/request failures, deadlines, interactive request rejection, token/origin checks, exclusive ownership through shutdown, and reconnect behavior.

The browser check uses the real phone client, relay, app-server adapter and WebRTC stack. It verifies inbound microphone packets at a local peer, outbound audio playback on the phone page, transcript display, Stop, a failed reconnect, mobile-width layout and absence of uncaught page errors.

## Live check on 2026-09-09

Codex 0.153.4, macOS, headless Chrome with synthetic microphone input:

- Metadata detected the existing ChatGPT login without reading or forwarding credentials.
- A live WebRTC v3 offer received an answer; the browser peer connected and its data channel opened.
- No OpenAI API key or separate voice provider was used.
- Synthetic speech was transcribed by the live voice service and delegated to GPT-6 Astra. The backing agent read a disposable local file and returned its exact contents, verified against its local task history.
- The voice service returned spoken acknowledgements. Under the default thinking handoff mode, the completed coding result remained silent. Runny now uses the supported bemTags mode to route final results to speech; the final tagged-result probe passed.
- One subsequent SDP attempt timed out and the client displayed the timeout correctly.
- A contextual appendText probe did not trigger a voice reply. V3 maps this method to session.context.append; acknowledgement is not a spoken turn or a coding result.

The final live probe used explicit `[COMMENTARY]` and `[FINAL]` instructions with `bemTags`. Its completed voice transcript was: "The file says exactly: amber otter seven three one." This matched the disposable file's `amber otter 731` contents. The browser received 47,674 inbound audio bytes across 1,208 packets and recorded 24.061 seconds of audio playback before teardown.

The complete observed path was synthetic microphone speech, live recognition, coding delegation, actual file read, and spoken result returned to the browser. The separate local peer test establishes repeatable transport/UI behavior without provider access. No production repository or provider data was changed by the live probe.

## Device check before running

Open the secure phone URL, allow the microphone, and ask Codex to read a harmless file in a disposable workspace. Confirm you hear its actual contents through the headphones. Stop and reconnect, briefly change networks, and test the exact screen-lock/background state you intend to use.

Physical iPhone, cellular handover, locked-screen audio and a full 10k-duration session have not been verified by automated desktop tests. Keep the computer awake. A home-screen icon is a shortcut, not a guarantee of background microphone access.
