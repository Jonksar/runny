import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { AppServerClient, AppServerError, compareVersions, parseVersion, MIN_REALTIME_CODEX } from "../dist/appserver.js";

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
      client.request("notify", {}).catch(() => {});
    });
    assert.deepEqual(seen, { status: "disabled" });
  } finally {
    await client.close();
  }
});

test("requests after close are rejected rather than hanging", async () => {
  const client = await start();
  await client.close();
  await assert.rejects(
    () => client.request("thread/realtime/listVoices", {}),
    /closed/,
  );
});

test("missing executable rejects startup without crashing", async () => {
  await assert.rejects(
    AppServerClient.start({ bin: "/nonexistent/runny-codex" }),
    /ENOENT/,
  );
});

test("unanswered requests time out and the client remains usable", async () => {
  const client = await AppServerClient.start({
    bin: FAKE,
    requestTimeoutMs: 1000,
  });
  try {
    await assert.rejects(client.request("no-response"), /timed out/);
    assert.equal(
      (await client.request("thread/realtime/listVoices")).voices.defaultV1,
      "cove",
    );
  } finally {
    await client.close();
  }
});

test("server requests cannot masquerade as responses with the same id", async () => {
  const client = await start();
  try {
    assert.deepEqual(await client.request("approval-collision"), {
      safe: true,
    });
  } finally {
    await client.close();
  }
});

test("version compare orders releases numerically, not lexically", () => {
  assert.equal(compareVersions("0.149.1", "0.153.4"), -1);
  assert.equal(compareVersions("0.153.4", "0.149.1"), 1);
  assert.equal(compareVersions("0.153.4", "0.153.4"), 0);
  // A string compare would put "0.9" above "0.10" and wave through a bad build.
  assert.equal(compareVersions("0.9.0", "0.10.0"), -1);
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
});

test("the realtime floor rejects the build that fails on quicksilver", () => {
  assert.ok(compareVersions("0.149.1", MIN_REALTIME_CODEX) < 0);
  assert.ok(compareVersions("0.153.4", MIN_REALTIME_CODEX) >= 0);
});

test("version is parsed out of the CLI banner", () => {
  assert.equal(parseVersion("codex-cli 0.153.4\n"), "0.153.4");
  assert.equal(parseVersion("no version here"), null);
});
