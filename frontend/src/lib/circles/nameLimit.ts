export const CIRCLE_NAME_MAX_BYTES = 64;

const encoder = new TextEncoder();

export function getUtf8ByteLength(value: string): number {
    return encoder.encode(value).length;
}

export function clampUtf8Bytes(value: string, maxBytes = CIRCLE_NAME_MAX_BYTES): string {
    if (getUtf8ByteLength(value) <= maxBytes) {
        return value;
    }

    let output = '';
    let byteLength = 0;

    for (const character of value) {
        const nextLength = getUtf8ByteLength(character);
        if (byteLength + nextLength > maxBytes) {
            break;
        }
        output += character;
        byteLength += nextLength;
    }

    return output;
}
