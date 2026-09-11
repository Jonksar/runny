/** Experimental Codex app-server methods, verified against 0.153.4. */
export declare const REALTIME_METHODS: {
    readonly start: "thread/realtime/start";
    readonly appendText: "thread/realtime/appendText";
    readonly stop: "thread/realtime/stop";
    readonly listVoices: "thread/realtime/listVoices";
};
export interface RealtimeVoicesList {
    voices: {
        v1: string[];
        v2: string[];
        defaultV1: string;
        defaultV2: string;
    };
}
