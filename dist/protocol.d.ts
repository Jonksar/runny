/** Phone/relay signaling only. WebRTC carries audio directly. */
export type ClientMessage = {
    type: "hello";
    sdp: string;
} | {
    type: "text";
    text: string;
} | {
    type: "bye";
};
export type ServerMessage = {
    type: "answer";
    threadId: string;
    sdp: string;
} | {
    type: "error";
    message: string;
};
export declare function encode(message: ClientMessage | ServerMessage): string;
export declare function decodeClientMessage(raw: string): ClientMessage | null;
