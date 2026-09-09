import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { startRelay } from "../dist/relay.js";

const FAKE = fileURLToPath(new URL("./fake-codex.js", import.meta.url));

async function withRelay(opts, fn) {
  const handle = await startRelay({
    port: 0, host: "127.0.0.1", cwd: process.cwd(), bin: FAKE, ...opts,
  });
  const { port } = handle.server.address();
  try {
    await fn(port);
  } finally {
    await handle.close();
  }
}

/** Collect frames until `done` says we have what we need. */
function collect(ws, done) {
  return new Promise((resolve, reject) => {
    const frames = [];
    const timer = setTimeout(() => reject(new Error("timed out: " + JSON.stringify(frames))), 5000);
    ws.on("message", (data, isBinary) => {
      frames.push(isBinary ? { binary: data } : JSON.parse(data.toString("utf8")));
      if (done(frames)) {
        clearTimeout(timer);
        resolve(frames);
      }
    });
    ws.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

test("hello opens a session and the relay reports ready then listening", async () => {
  await withRelay({}, async (port) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    await new Promise((r) => ws.once("open", r));
    const wait = collect(ws, (f) => f.some((m) => m.type === "state" && m.state === "listening"));
    ws.send(JSON.stringify({ type: "hello", sampleRate: 48000 }));
    const frames = await wait;

    const ready = frames.find((m) => m.type === "ready");
    assert.ok(ready, "expected a ready frame");
    assert.equal(ready.threadId, "thread-fake-1");
    assert.equal(ready.sampleRate, 48000);
    ws.close();
  });
});

test("microphone audio round trips back as binary", async () => {
  await withRelay({}, async (port) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    ws.binaryType = "nodebuffer";
    await new Promise((r) => ws.once("open", r));

    const ready = collect(ws, (f) => f.some((m) => m.type === "ready"));
    ws.send(JSON.stringify({ type: "hello", sampleRate: 48000 }));
    await ready;

    const audioBack = collect(ws, (f) => f.some((m) => m.binary));
    const pcm = new Int16Array([1, 2, 3, 4, 5, 6]);
    ws.send(Buffer.from(pcm.buffer), { binary: true });
    const frames = await audioBack;

    const chunk = frames.find((m) => m.binary).binary;
    assert.ok(chunk.byteLength > 0, "expected non-empty audio back");
    assert.equal(chunk.byteLength % 2, 0, "audio must be whole PCM16 samples");
    ws.close();
  });
});

test("a bad token is refused at upgrade", async () => {
  await withRelay({ token: "secret" }, async (port) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=wrong`);
    await assert.rejects(
      () => new Promise((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
      }),
    );
  });
});

test("a good token is accepted", async () => {
  await withRelay({ token: "secret" }, async (port) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=secret`);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    ws.close();
  });
});

test("static client is served and traversal is refused", async () => {
  await withRelay({}, async (port) => {
    const index = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /runny/);

    const escaped = await fetch(`http://127.0.0.1:${port}/../package.json`);
    assert.notEqual(escaped.status, 200);
  });
});

test("malformed control frames are ignored rather than fatal", async () => {
  await withRelay({}, async (port) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    await new Promise((r) => ws.once("open", r));
    ws.send("{not json");
    ws.send(JSON.stringify({ type: "launch_missiles" }));

    const ready = collect(ws, (f) => f.some((m) => m.type === "ready"));
    ws.send(JSON.stringify({ type: "hello", sampleRate: 48000 }));
    await ready;
    ws.close();
  });
});
