#!/usr/bin/env node
// Stands in for `codex app-server` so the client can be tested without a real
// account, quota, or network. Speaks just enough of the protocol to exercise
// the handshake, id correlation, notifications, and error mapping.
if (process.argv.includes("--version")) {
  console.log("fake-codex 0.153.4");
  process.exit(0);
}
let buffer = "";
let experimental = false;

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) handle(JSON.parse(line));
  }
});

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

function handle(msg) {
  if (msg.method === "no-response") return;
  if (msg.method === "notify") {
    send({
      method: "remoteControl/status/changed",
      params: { status: "disabled" },
    });
    send({ id: msg.id, result: {} });
    return;
  }
  if (msg.method === "approval-collision") {
    send({
      id: msg.id,
      method: "item/commandExecution/requestApproval",
      params: {},
    });
    setTimeout(() => send({ id: msg.id, result: { safe: true } }), 10);
    return;
  }
  if (!msg.method) return;
  if (msg.method === "initialize") {
    experimental = msg.params?.capabilities?.experimentalApi === true;
    send({ id: msg.id, result: { userAgent: "fake/0.0.0", experimental } });
    // An unsolicited notification, which the real server also emits here.
    send({
      method: "remoteControl/status/changed",
      params: { status: "disabled" },
    });
    return;
  }
  if (msg.method === "initialized") return;

  if (msg.method === "thread/realtime/listVoices") {
    if (!experimental) {
      send({
        id: msg.id,
        error: { code: -32600, message: "requires experimentalApi capability" },
      });
      return;
    }
    send({
      id: msg.id,
      result: {
        voices: {
          v1: ["cove"],
          v2: ["marin"],
          defaultV1: "cove",
          defaultV2: "marin",
        },
      },
    });
    return;
  }

  if (msg.method === "account/read") {
    send({ id: msg.id, result: { account: null } });
    return;
  }
  if (msg.method === "thread/start") {
    send({ id: msg.id, result: { thread: { id: "thread-fake-1" } } });
    return;
  }

  if (msg.method === "thread/realtime/start") {
    const p = msg.params;
    if (p.codexResponseHandoffMode !== "bemTags") {
      send({
        id: msg.id,
        error: {
          code: -32602,
          message: "Speakable coding-result handoff is required",
        },
      });
      return;
    }
    if (p.transport?.type !== "webrtc" || p.version !== "v3") {
      send({
        id: msg.id,
        error: { code: -32602, message: "WebRTC v3 required" },
      });
      return;
    }
    send({ id: msg.id, result: {} });
    if (process.env.RUNNY_FAKE_PEER) {
      void fetch(process.env.RUNNY_FAKE_PEER, {
        method: "POST",
        body: p.transport.sdp,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(await res.text());
          send({
            method: "thread/realtime/sdp",
            params: { threadId: p.threadId, sdp: await res.text() },
          });
        })
        .catch((err) =>
          send({
            method: "thread/realtime/error",
            params: { threadId: p.threadId, message: err.message },
          }),
        );
      return;
    }
    if (p.transport.sdp.includes("no-answer")) return;
    setTimeout(() => {
      if (p.transport.sdp.includes("reject")) {
        send({
          method: "thread/realtime/error",
          params: { threadId: p.threadId, message: "voice unavailable" },
        });
        return;
      }
      send({
        method: "thread/realtime/started",
        params: {
          threadId: p.threadId,
          version: "v3",
          realtimeSessionId: "rt-1",
        },
      });
      send({
        method: "thread/realtime/sdp",
        params: { threadId: p.threadId, sdp: "v=0\r\nanswer" },
      });
    }, 20);
    return;
  }

  if (msg.method === "thread/realtime/appendAudio") {
    send({ id: msg.id, result: {} });
    // Echo one chunk back so the relay's outbound audio path is exercised.
    send({
      method: "thread/realtime/outputAudio/delta",
      params: {
        threadId: msg.params.threadId,
        audio: {
          data: Buffer.from(new Int16Array([100, -100, 200]).buffer).toString(
            "base64",
          ),
          sampleRate: 24000,
          numChannels: 1,
          samplesPerChannel: 3,
          itemId: null,
        },
      },
    });
    return;
  }

  if (msg.method === "thread/realtime/stop") {
    send({ id: msg.id, result: {} });
    return;
  }

  if (msg.method === "slow") {
    setTimeout(() => send({ id: msg.id, result: { slow: true } }), 40);
    return;
  }

  if (msg.method === "split") {
    // Deliver one JSON object across two writes to exercise line buffering.
    const body = JSON.stringify({ id: msg.id, result: { split: true } });
    process.stdout.write(body.slice(0, 5));
    setTimeout(() => process.stdout.write(body.slice(5) + "\n"), 10);
    return;
  }

  send({
    id: msg.id,
    error: { code: -32601, message: `method not found: ${msg.method}` },
  });
}
