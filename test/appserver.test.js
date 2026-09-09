import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { AppServerClient, AppServerError } from "../dist/appserver.js";

const FAKE = fileURLToPath(new URL("./fake-codex.js", import.meta.url));
const start = () => AppServerClient.start({ bin: FAKE });

test("handshake declares experimentalApi so realtime methods are reachable", async () => {
  const client = await start();
  try {
    const result = await client.request("thread/realtime/listVoices", {});
    assert.equal(result.voices.defaultV2, "marin");
  } finally {
    await client.close();
  }
});

test("errors surface as AppServerError carrying code and method", async () => {
  const client = await start();
  try {
    await assert.rejects(
      () => client.request("thread/nope", {}),
      (err) => {
        assert.ok(err instanceof AppServerError);
        assert.equal(err.code, -32601);
        assert.equal(err.method, "thread/nope");
        assert.match(err.message, /method not found/);
        return true;
      },
    );
  } finally {
    await client.close();
  }
});

test("concurrent requests resolve to their own results", async () => {
  const client = await start();
  try {
    const [slow, voices] = await Promise.all([
      client.request("slow", {}),
      client.request("thread/realtime/listVoices", {}),
    ]);
    assert.deepEqual(slow, { slow: true });
    assert.equal(voices.voices.defaultV1, "cove");
  } finally {
    await client.close();
  }
});

test("a response split across two writes is reassembled", async () => {
  const client = await start();
  try {
    assert.deepEqual(await client.request("split", {}), { split: true });
  } finally {
    await client.close();
  }
});

test("notifications reach both the generic and per-method listener", async () => {
  const client = await start();
  try {
    const seen = await new Promise((resolve) => {
      client.once("remoteControl/status/changed", (params) => resolve(params));
      client.request("thread/realtime/listVoices", {}).catch(() => {});
    });
    assert.deepEqual(seen, { status: "disabled" });
  } finally {
    await client.close();
  }
});

test("requests after close are rejected rather than hanging", async () => {
  const client = await start();
  await client.close();
  await assert.rejects(() => client.request("thread/realtime/listVoices", {}), /closed/);
});
