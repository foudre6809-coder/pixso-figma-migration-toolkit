import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  encrypted: boolean;
  data?: Uint8Array;
}

const MAX_ENTRY_BYTES = 512 * 1024 * 1024;

export function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndRecord(buffer);
  if (endOffset < 0) throw new Error("ZIP central directory not found");
  const count = buffer.readUInt16LE(endOffset + 10);
  let cursor = buffer.readUInt32LE(endOffset + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central directory entry ${index}`);
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const entry: ZipEntry = {
      name,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      encrypted: Boolean(flags & 1)
    };

    if (!entry.encrypted && uncompressedSize <= MAX_ENTRY_BYTES) {
      if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
        throw new Error(`Invalid local ZIP header for ${JSON.stringify(name)}`);
      }
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      if (compressed.length !== compressedSize) throw new Error(`Truncated ZIP entry ${JSON.stringify(name)}`);
      if (compressionMethod === 0) entry.data = Uint8Array.from(compressed);
      if (compressionMethod === 8) {
        entry.data = inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
      }
    }
    entries.push(entry);
    cursor = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndRecord(buffer: Buffer): number {
  const lowerBound = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}
