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
test("voices honors the selected binary without spending model tokens", async () => {
  const { stdout } = await run(
    process.execPath,
    [cli, "voices", "--codex-bin", bin],
    { timeout: 5000 },
  );
  assert.match(stdout, /cove/);
});
