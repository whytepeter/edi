import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * `.edichar` files are ordinary zip archives holding `character.json` and `art.svg`. This reads
 * only what a character needs, with hard limits, and never touches the file system: entry names
 * are matched, not used as paths, so an archive cannot write anywhere.
 */

export const packageExtension = '.edichar';
export const maxPackageBytes = 2_000_000;
const maxEntryBytes = 1_000_000;
const maxEntries = 32;
/** Files a package may carry; anything else (a README, __MACOSX) is ignored. */
const wanted = ['character.json', 'art.svg'] as const;
type Wanted = (typeof wanted)[number];

export class PackageError extends Error {}

export interface PackageFiles {
  manifest: string;
  art: string;
}

/** Reads the two package files from zip bytes. A single top-level folder is allowed. */
export function readCharacterPackage(bytes: Uint8Array): PackageFiles {
  if (bytes.byteLength > maxPackageBytes)
    throw new PackageError(`The package is larger than ${maxPackageBytes / 1_000_000} MB.`);
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // End of central directory: the last 22 bytes, or further back if there is a comment.
  let end = -1;
  for (let at = data.length - 22; at >= Math.max(0, data.length - 22 - 65_535); at--) {
    if (data.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new PackageError('This is not a character package (not a zip archive).');
  const count = data.readUInt16LE(end + 10);
  const directorySize = data.readUInt32LE(end + 12);
  const directoryStart = data.readUInt32LE(end + 16);
  if (count > maxEntries) throw new PackageError(`The package has more than ${maxEntries} files.`);
  if (directoryStart + directorySize > end) throw new PackageError('The package is damaged.');

  const found = new Map<Wanted, string>();
  let at = directoryStart;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || data.readUInt32LE(at) !== 0x02014b50)
      throw new PackageError('The package is damaged.');
    const flags = data.readUInt16LE(at + 8);
    const method = data.readUInt16LE(at + 10);
    const expectedCrc = data.readUInt32LE(at + 16);
    const compressed = data.readUInt32LE(at + 20);
    const size = data.readUInt32LE(at + 24);
    const nameLength = data.readUInt16LE(at + 28);
    const extraLength = data.readUInt16LE(at + 30);
    const commentLength = data.readUInt16LE(at + 32);
    const localHeader = data.readUInt32LE(at + 42);
    const name = data.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;

    const base = name.replace(/^[^/]+\//, '');
    const file = wanted.find(candidate => candidate === name || candidate === base);
    if (!file || name.startsWith('__MACOSX/')) continue;
    if (found.has(file)) throw new PackageError(`The package contains ${file} more than once.`);
    if (flags & 0x1) throw new PackageError('Encrypted packages are not supported.');
    if (size > maxEntryBytes || compressed > maxEntryBytes)
      throw new PackageError(`${file} is too large.`);
    if (localHeader + 30 > data.length || data.readUInt32LE(localHeader) !== 0x04034b50)
      throw new PackageError('The package is damaged.');
    const start =
      localHeader + 30 + data.readUInt16LE(localHeader + 26) + data.readUInt16LE(localHeader + 28);
    if (start + compressed > data.length) throw new PackageError('The package is damaged.');
    const raw = data.subarray(start, start + compressed);
    let content: Buffer;
    if (method === 0) content = raw;
    else if (method === 8) {
      try {
        content = inflateRawSync(raw, { maxOutputLength: maxEntryBytes });
      } catch {
        throw new PackageError(`${file} could not be unpacked.`);
      }
    } else throw new PackageError(`${file} uses an unsupported compression method.`);
    if (content.length !== size || crc32(content) !== expectedCrc)
      throw new PackageError(`${file} is damaged.`);
    found.set(file, content.toString('utf8'));
  }
  const manifest = found.get('character.json');
  const art = found.get('art.svg');
  if (!manifest || !art)
    throw new PackageError('A character package needs character.json and art.svg.');
  return { manifest, art };
}

/** Writes a small zip (deflated entries, no folders) for `edi character pack`. */
export function writeCharacterPackage(files: PackageFiles): Buffer {
  const entries = [
    { name: 'character.json', data: Buffer.from(files.manifest, 'utf8') },
    { name: 'art.svg', data: Buffer.from(files.art, 'utf8') },
  ];
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, compressed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
