'use strict';
/**
 * Minimal ZIP reader (no dependency): lists the entries of a .zip held in memory and
 * extracts one of them (stored or deflated). Enough for the FFmpeg archive; ZIP64 is not supported.
 */
const zlib = require('zlib');

function listEntries(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip file (end of central directory not found)');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < total; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip (bad central directory)');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    if (csize === 0xffffffff || usize === 0xffffffff || offset === 0xffffffff) throw new Error('ZIP64 archives are not supported');
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, csize, usize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extract(buf, entry) {
  const lo = entry.offset;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('corrupt zip (bad local header)');
  const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
  const raw = buf.subarray(start, start + entry.csize);
  let out;
  if (entry.method === 0) out = Buffer.from(raw);
  else if (entry.method === 8) out = zlib.inflateRawSync(raw);
  else throw new Error(`unsupported compression method ${entry.method}`);
  if (out.length !== entry.usize) throw new Error(`size mismatch for ${entry.name}`);
  return out;
}

module.exports = { listEntries, extract };
