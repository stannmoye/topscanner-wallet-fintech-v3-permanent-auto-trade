import { inflateRawSync } from "node:zlib";

/**
 * Tender Bid — minimal, dependency-free ZIP reader.
 *
 * Some official sources publish a daily/monthly ZIP bundle (Germany's
 * `oeffentlichevergabe.de/api/notice-exports` returns an OCDS/eForms bundle as a
 * ZIP). Parsing the archive through the central directory keeps this small and
 * self-contained instead of pulling a general-purpose archive dependency into the
 * server bundle. Only STORED (0) and DEFLATE (8) entries are supported, which is
 * what these exports use; anything else is skipped rather than guessed.
 */

export type ZipEntry = { name: string; data: Buffer };

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIRECTORY_SIG = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIG = 0x06054b50;
const STORED = 0;
const DEFLATE = 8;

/**
 * Upper bound on one member's decompressed size, so a ZIP bomb (or a member whose
 * declared size lies) cannot exhaust the heap while inflating. An archive that
 * exceeds it throws, which the caller records as a failed source (fail closed).
 */
const MAX_ENTRY_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

/** Upper bound on an archive's total decompressed size across all members. */
const MAX_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset--) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIG) return offset;
  }
  throw new Error("ZIP archive has no end-of-central-directory record");
}

/** Read every file entry from a ZIP buffer, inflating DEFLATE members. */
export function readZipEntries(buffer: Buffer): ZipEntry[] {
  if (buffer.length < 22) throw new Error("ZIP archive is too small to be valid");
  const eocd = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  let directoryOffset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  let totalUncompressed = 0;

  for (let index = 0; index < totalEntries; index++) {
    if (directoryOffset + 46 > buffer.length || buffer.readUInt32LE(directoryOffset) !== CENTRAL_DIRECTORY_SIG) {
      throw new Error("ZIP central directory is truncated or malformed");
    }
    const method = buffer.readUInt16LE(directoryOffset + 10);
    const compressedSize = buffer.readUInt32LE(directoryOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(directoryOffset + 24);
    const nameLength = buffer.readUInt16LE(directoryOffset + 28);
    const extraLength = buffer.readUInt16LE(directoryOffset + 30);
    const commentLength = buffer.readUInt16LE(directoryOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(directoryOffset + 42);
    const name = buffer.toString("utf8", directoryOffset + 46, directoryOffset + 46 + nameLength);
    directoryOffset += 46 + nameLength + extraLength + commentLength;

    // Directory markers have no payload.
    if (name.endsWith("/")) continue;
    if (uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error(`ZIP member ${name} declares ${uncompressedSize} bytes, over the ${MAX_ENTRY_UNCOMPRESSED_BYTES}-byte limit`);
    }
    if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIG) {
      throw new Error("ZIP local file header is missing for " + name);
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    if (method === STORED) {
      const data = Buffer.from(compressed);
      totalUncompressed += data.length;
      if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new Error("ZIP archive exceeds the decompressed-size limit");
      entries.push({ name, data });
    } else if (method === DEFLATE) {
      // `maxOutputLength` bounds the inflate itself, so a lying size header cannot
      // allocate past the per-member limit before it is checked.
      const data = inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_UNCOMPRESSED_BYTES });
      totalUncompressed += data.length;
      if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new Error("ZIP archive exceeds the decompressed-size limit");
      entries.push({ name, data });
    }
    // Unsupported compression methods are skipped rather than silently corrupted.
  }
  return entries;
}
