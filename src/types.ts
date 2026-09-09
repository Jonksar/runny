/** Experimental Codex app-server methods, verified against 0.153.4. */
export const REALTIME_METHODS = {
  start: "thread/realtime/start",
  appendText: "thread/realtime/appendText",
  stop: "thread/realtime/stop",
  listVoices: "thread/realtime/listVoices",
} as const;
export interface RealtimeVoicesList {
  voices: { v1: string[]; v2: string[]; defaultV1: string; defaultV2: string };
}
