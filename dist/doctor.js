import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppServerClient, compareVersions, defaultCodexBin, MIN_REALTIME_CODEX, parseVersion, } from "./appserver.js";
import { REALTIME_METHODS } from "./types.js";
/** Metadata checks only. This does not open or certify a live voice session. */
export async function diagnose(options = {}) {
    const checks = [];
    const bin = options.bin ?? defaultCodexBin();
    checks.push({
        name: "node",
        ok: Number(process.versions.node.split(".")[0]) >= 22,
        detail: process.version,
    });
    try {
        const { stdout } = await promisify(execFile)(bin, ["--version"], {
            timeout: 5000,
        });
        const version = parseVersion(stdout);
        // Reporting the version is not enough. A build below the floor passes every
        // other check here and then fails mid-call with an opaque alpha-header
        // error, which is exactly the case doctor exists to catch indoors.
        const tooOld = version !== null && compareVersions(version, MIN_REALTIME_CODEX) < 0;
        checks.push({
            name: "codex",
            ok: !tooOld,
            detail: tooOld
                ? `${stdout.trim()} at ${bin} is too old for realtime. Need >= ${MIN_REALTIME_CODEX}; the build inside ChatGPT.app is usually newer.`
                : `${stdout.trim()} (${bin})`,
        });
    }
    catch {
        checks.push({
            name: "codex",
            ok: false,
            detail: "Executable unavailable. Install Codex or use --codex-bin.",
        });
        return checks;
    }
    let client;
    try {
        client = await AppServerClient.start({ ...options, bin });
        const result = await client.request("account/read", { refreshToken: false });
        checks.push({
            name: "account",
            ok: result.account?.type === "chatgpt",
            detail: result.account?.type === "chatgpt"
                ? "ChatGPT login available; credentials stay with Codex."
                : "Sign in with ChatGPT using codex login.",
        });
        const { voices } = await client.request(REALTIME_METHODS.listVoices, {});
        checks.push({
            name: "protocol",
            ok: true,
            detail: `Voice metadata available (${voices.v1.length + voices.v2.length} entries).`,
        });
        const limits = await client
            .request("account/rateLimits/read", {})
            .catch(() => null);
        if (limits?.rateLimits) {
            const { primary, secondary } = limits.rateLimits;
            checks.push({
                name: "usage",
                ok: true,
                detail: `Current windows used: ${primary?.usedPercent ?? "unknown"}%, ${secondary?.usedPercent ?? "unknown"}%. Voice access is checked when connecting.`,
            });
        }
    }
    catch (err) {
        checks.push({
            name: "app-server",
            ok: false,
            detail: err instanceof Error ? err.message : "Connection failed",
        });
    }
    finally {
        await client?.close();
    }
    checks.push({
        name: "voice",
        ok: false,
        warning: true,
        detail: "Not tested by doctor. Start a short call before relying on this outdoors.",
    });
    return checks;
}
export function renderChecks(checks) {
    return checks
        .map((c) => `  [${c.ok ? "ok" : c.warning ? "warn" : "FAIL"}] ${c.name}: ${c.detail}`)
        .join("\n");
}
//# sourceMappingURL=doctor.js.map