#!/usr/bin/env node
// Stands in for `codex app-server` so the client can be tested without a real
// account, quota, or network. Speaks just enough of the protocol to exercise
// the handshake, id correlation, notifications, and error mapping.
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
  if (msg.method === "initialize") {
    experimental = msg.params?.capabilities?.experimentalApi === true;
    send({ id: msg.id, result: { userAgent: "fake/0.0.0", experimental } });
    // An unsolicited notification, which the real server also emits here.
    send({ method: "remoteControl/status/changed", params: { status: "disabled" } });
    return;
  }
  if (msg.method === "initialized") return;

  if (msg.method === "thread/realtime/listVoices") {
    if (!experimental) {
      send({ id: msg.id, error: { code: -32600, message: "requires experimentalApi capability" } });
      return;
    }
    send({ id: msg.id, result: { voices: { v1: ["cove"], v2: ["marin"], defaultV1: "cove", defaultV2: "marin" } } });
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

  send({ id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } });
}
