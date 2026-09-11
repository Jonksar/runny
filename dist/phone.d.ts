export interface PhoneLink {
    url: string;
    /** Whether `tailscale serve` already proxies HTTPS to the relay port. */
    served: boolean;
}
/** The HTTPS link a phone on the same tailnet opens. */
export declare function phoneUrl(dnsName: string, token: string): string;
/** True when `tailscale serve status --json` output proxies to the local port. */
export declare function servesPort(status: string, port: number): boolean;
/** Best effort. Returns null when Tailscale is missing or logged out. */
export declare function tailscaleLink(port: number, token: string): Promise<PhoneLink | null>;
