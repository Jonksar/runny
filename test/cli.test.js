import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const cli = new URL("../dist/cli.js", import.meta.url).pathname;
const bin = new URL("./fake-codex.js", import.meta.url).pathname;
test("invalid CLI options fail instead of silently starting the server", async () => {
  for (const args of [
    ["--sandbox", "typo"],
    ["--port", "nan"],
    ["--cwd"],
    ["--surprise"],
  ]) {
    await assert.rejects(
      run(process.execPath, [cli, ...args], { timeout: 2000 }),
      (err) => err.code === 1 && /runny:/.test(err.stderr),
    );
  }
});
test("doctor honors the selected binary and reports an unsigned account", async () => {
  await assert.rejects(
    run(process.execPath, [cli, "doctor", "--codex-bin", bin], {
      timeout: 5000,
    }),
    (err) => err.code === 1 && /sign in/i.test(err.stdout),
  );
});
test("phone link uses the tailnet name and detects an existing serve", async () => {
  const { phoneUrl, servesPort } = await import("../dist/phone.js");
  assert.equal(
    phoneUrl("mac.tail1234.ts.net.", "a b"),
    "https://mac.tail1234.ts.net/#token=a%20b",
  );
  const status = '{"Web":{"mac.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8765"}}}}}';
  assert.equal(servesPort(status, 8765), true);
  assert.equal(servesPort(status, 876), false);
  assert.equal(servesPort("", 8765), false);
});
test("voices honors the selected binary without spending model tokens", async () => {
  const { stdout } = await run(
    process.execPath,
    [cli, "voices", "--codex-bin", bin],
    { timeout: 5000 },
  );
  assert.match(stdout, /cove/);
});
