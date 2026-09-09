import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppServerClient } from "./appserver.js";
import { REALTIME_METHODS, type RealtimeVoicesList } from "./types.js";

const run = promisify(execFile);

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  /** A failed check that still lets the rest of the run proceed. */
  warning?: boolean;
}

interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number;
}

interface RateLimits {
  rateLimits: {
    primary: RateLimitWindow | null;
    planType: string | null;
    credits: { hasCredits: boolean; balance: string } | null;
  };
  rateLimitsByLimitId?: Record<string, { limitName: string | null; primary: RateLimitWindow | null }>;
}

function formatReset(epochSeconds: number): string {
  const ms = epochSeconds * 1000;
  const hours = (ms - Date.now()) / 3_600_000;
  const when = new Date(ms).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  if (hours < 0) return `${when} (passed)`;
  if (hours < 48) return `${when}, in ${hours.toFixed(1)}h`;
  return `${when}, in ${(hours / 24).toFixed(1)} days`;
}

/**
 * Verify everything a run needs before you are three kilometres from the house.
 *
 * The quota check earns its place: realtime sessions draw on the same weekly
 * allowance as ordinary Codex usage, and a exhausted allowance fails at
 * session start rather than at connect, which looks like a broken relay.
 */
export async function diagnose(): Promise<Check[]> {
  const checks: Check[] = [];

  const major = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node",
    ok: major >= 22,
    detail: major >= 22 ? `v${process.versions.node}` : `v${process.versions.node}, needs >= 22`,
  });

  let codexOk = false;
  try {
    const { stdout } = await run("codex", ["--version"]);
    codexOk = true;
    checks.push({ name: "codex", ok: true, detail: stdout.trim() });
  } catch {
    checks.push({ name: "codex", ok: false, detail: "not on PATH, install the Codex CLI" });
  }

  try {
    await run("tailscale", ["version"]);
    checks.push({ name: "tailscale", ok: true, detail: "available for tunnelling" });
  } catch {
    checks.push({
      name: "tailscale", ok: false, warning: true,
      detail: "not found, you will need another HTTPS tunnel to reach a phone",
    });
  }

  if (!codexOk) return checks;

  let client: AppServerClient | null = null;
  try {
    client = await AppServerClient.start();

    const auth = await client
      .request<{ authMethod?: string; authenticated?: boolean }>("getAuthStatus", {})
      .catch(() => null);
    checks.push({
      name: "auth",
      ok: auth !== null,
      detail: auth ? `signed in (${auth.authMethod ?? "chatgpt"})` : "run `codex login`",
    });

    try {
      const voices = await client.request<RealtimeVoicesList>(REALTIME_METHODS.listVoices, {});
      checks.push({
        name: "realtime",
        ok: true,
        detail: `${voices.voices.v2.length} voices, default ${voices.voices.defaultV2}`,
      });
    } catch (err) {
      checks.push({
        name: "realtime", ok: false,
        detail: err instanceof Error ? err.message : "realtime unavailable",
      });
    }

    const limits = await client.request<RateLimits>("account/rateLimits/read", {}).catch(() => null);
    if (limits?.rateLimits?.primary) {
      const p = limits.rateLimits.primary;
      const spent = p.usedPercent >= 100;
      const credits = limits.rateLimits.credits;
      const hasCredits = credits?.hasCredits === true;
      checks.push({
        name: "quota",
        ok: !spent || hasCredits,
        detail: spent
          ? `${p.usedPercent}% used on plan ${limits.rateLimits.planType ?? "?"}, resets ${formatReset(p.resetsAt)}`
          : `${p.usedPercent}% used, window resets ${formatReset(p.resetsAt)}`,
      });

      if (spent) {
        for (const [id, entry] of Object.entries(limits.rateLimitsByLimitId ?? {})) {
          if (entry.primary && entry.primary.usedPercent < 100 && id !== "codex") {
            checks.push({
              name: "quota alt", ok: true, warning: true,
              detail: `${entry.limitName ?? id} has ${100 - entry.primary.usedPercent}% left, try --model`,
            });
          }
        }
      }
    }
  } catch (err) {
    checks.push({
      name: "app-server", ok: false,
      detail: err instanceof Error ? err.message : "could not start codex app-server",
    });
  } finally {
    await client?.close();
  }

  return checks;
}

export function renderChecks(checks: Check[]): string {
  const lines = checks.map((c) => {
    const mark = c.ok ? "ok  " : c.warning ? "warn" : "FAIL";
    return `  [${mark}] ${c.name.padEnd(10)} ${c.detail}`;
  });
  const blocking = checks.filter((c) => !c.ok && !c.warning);
  lines.push("");
  lines.push(blocking.length === 0 ? "ready to run" : `${blocking.length} blocking problem(s)`);
  return lines.join("\n");
}
