import { type Server } from "node:http";
import { type SessionOptions } from "./session.js";
export interface RelayOptions extends Omit<SessionOptions, "sdp" | "signal"> {
    port: number;
    host: string;
    cwd: string;
    token?: string;
}
export interface RelayHandle {
    server: Server;
    close: () => Promise<void>;
}
export declare function startRelay(options: RelayOptions): Promise<RelayHandle>;
