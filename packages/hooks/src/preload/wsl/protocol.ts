export const WSL_PROTOCOL_VERSION = 1
export const MAX_WSL_FRAME_PAYLOAD = 16 * 1024 * 1024

const HEADER_SIZE = 9
const LENGTH_SIZE = 4

export enum WslFrameKind {
  Hello = 1,
  HelloAck = 2,
  Spawn = 3,
  Spawned = 4,
  Stdin = 5,
  StdinEnd = 6,
  Stdout = 7,
  Stderr = 8,
  Kill = 9,
  Exit = 10,
  Error = 11,
  Shutdown = 12,
  Ping = 13,
  Pong = 14,
}

export interface WslFrame {
  kind: WslFrameKind
  requestId: number
  payload: Buffer
}

export function encodeWslFrame(
  kind: WslFrameKind,
  requestId: number,
  payload: Buffer = Buffer.alloc(0),
): Buffer {
  if (!Number.isSafeInteger(requestId) || requestId < 0) {
    throw new RangeError(`Invalid WSL request id: ${requestId}`)
  }
  if (payload.length > MAX_WSL_FRAME_PAYLOAD) {
    throw new RangeError(`WSL frame payload exceeds ${MAX_WSL_FRAME_PAYLOAD} bytes`)
  }

  const frameLength = HEADER_SIZE + payload.length
  const result = Buffer.allocUnsafe(LENGTH_SIZE + frameLength)
  result.writeUInt32BE(frameLength, 0)
  result.writeUInt8(kind, LENGTH_SIZE)
  result.writeBigUInt64BE(BigInt(requestId), LENGTH_SIZE + 1)
  payload.copy(result, LENGTH_SIZE + HEADER_SIZE)
  return result
}

export function encodeWslJsonFrame(
  kind: WslFrameKind,
  requestId: number,
  payload: unknown,
): Buffer {
  return encodeWslFrame(kind, requestId, Buffer.from(JSON.stringify(payload)))
}

export class WslFrameParser {
  private buffered: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): WslFrame[] {
    if (chunk.length > 0) {
      this.buffered = this.buffered.length === 0
        ? chunk
        : Buffer.concat([this.buffered, chunk])
    }

    const frames: WslFrame[] = []
    while (this.buffered.length >= LENGTH_SIZE) {
      const frameLength = this.buffered.readUInt32BE(0)
      if (frameLength < HEADER_SIZE || frameLength > HEADER_SIZE + MAX_WSL_FRAME_PAYLOAD) {
        throw new Error(`Invalid WSL frame length: ${frameLength}`)
      }

      const totalLength = LENGTH_SIZE + frameLength
      if (this.buffered.length < totalLength) break

      const kind = this.buffered.readUInt8(LENGTH_SIZE)
      if (kind < WslFrameKind.Hello || kind > WslFrameKind.Pong) {
        throw new Error(`Unknown WSL frame kind: ${kind}`)
      }
      const requestId = Number(this.buffered.readBigUInt64BE(LENGTH_SIZE + 1))
      if (!Number.isSafeInteger(requestId)) {
        throw new Error(`WSL request id exceeds JavaScript's safe integer range: ${requestId}`)
      }

      frames.push({
        kind: kind as WslFrameKind,
        requestId,
        payload: Buffer.from(this.buffered.subarray(LENGTH_SIZE + HEADER_SIZE, totalLength)),
      })
      this.buffered = this.buffered.subarray(totalLength)
    }
    return frames
  }

  finish(): void {
    if (this.buffered.length !== 0) {
      throw new Error(`WSL agent closed with ${this.buffered.length} incomplete protocol bytes`)
    }
  }
}
