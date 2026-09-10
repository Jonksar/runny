import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const TAILSCALE_BINS = [
  "tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
];
export interface PhoneLink {
  url: string;
  /** Whether `tailscale serve` already proxies HTTPS to the relay port. */
  served: boolean;
}
/** The HTTPS link a phone on the same tailnet opens. */
export function phoneUrl(dnsName: string, token: string): string {
  return `https://${dnsName.replace(/\.$/, "")}/#token=${encodeURIComponent(token)}`;
}
/** True when `tailscale serve status --json` output proxies to the local port. */
export function servesPort(status: string, port: number): boolean {
  return new RegExp(`(127\\.0\\.0\\.1|localhost):${port}\\b`).test(status);
}
/** Best effort. Returns null when Tailscale is missing or logged out. */
export async function tailscaleLink(
  port: number,
  token: string,
): Promise<PhoneLink | null> {
  for (const bin of TAILSCALE_BINS) {
    let dns: unknown;
    try {
      const { stdout } = await run(bin, ["status", "--json"], {
        timeout: 3000,
      });
      dns = JSON.parse(stdout).Self?.DNSName;
    } catch {
      continue;
    }
    if (typeof dns !== "string" || !dns) return null;
    const serve = await run(bin, ["serve", "status", "--json"], {
      timeout: 3000,
    }).then(
      (r) => r.stdout,
      () => "",
    );
    return { url: phoneUrl(dns, token), served: servesPort(serve, port) };
  }
  return null;
}
