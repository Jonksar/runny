export function encode(message) {
    return JSON.stringify(message);
}
export function decodeClientMessage(raw) {
    let value;
    try {
        value = JSON.parse(raw);
    }
    catch {
        return null;
    }
    if (!value || typeof value !== "object")
        return null;
    const msg = value;
    if (msg.type === "bye")
        return { type: "bye" };
    if (msg.type === "hello" &&
        typeof msg.sdp === "string" &&
        msg.sdp.startsWith("v=0") &&
        msg.sdp.length <= 65_536) {
        return { type: "hello", sdp: msg.sdp };
    }
    if (msg.type === "text" &&
        typeof msg.text === "string" &&
        msg.text.trim() &&
        msg.text.length <= 8_192) {
        return { type: "text", text: msg.text };
    }
    return null;
}
//# sourceMappingURL=protocol.js.map