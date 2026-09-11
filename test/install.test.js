import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const project = new URL("..", import.meta.url).pathname;

test("GitHub-style global install exposes the runny command", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "runny-install-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const prefix = join(root, "prefix");

  for (const entry of [
    "dist",
    "docs",
    "src",
    "web",
    "LICENSE",
    "README.md",
    "package-lock.json",
    "package.json",
    "tsconfig.json",
  ]) {
    cpSync(join(project, entry), join(source, entry), { recursive: true });
  }

  await run("git", ["init", "--quiet", source]);
  await run("git", ["-C", source, "add", "."]);
  await run("git", [
    "-C",
    source,
    "-c",
    "user.name=Runny test",
    "-c",
    "user.email=runny@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);

  await run(
    "npm",
    [
      "install",
      "--global",
      "--install-links=true",
      "--prefix",
      prefix,
      `git+file://${source}`,
    ],
    { timeout: 60_000 },
  );
  const { stdout } = await run(join(prefix, "bin", "runny"), ["--version"]);

  assert.equal(stdout.trim(), "0.2.0");
});
