import { type AppServerOptions } from "./appserver.js";
export interface Check {
    name: string;
    ok: boolean;
    detail: string;
    warning?: boolean;
}
/** Metadata checks only. This does not open or certify a live voice session. */
export declare function diagnose(options?: AppServerOptions): Promise<Check[]>;
export declare function renderChecks(checks: Check[]): string;
