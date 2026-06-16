import { createWriteStream, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { deflateRawSync } from "node:zlib";

const SIG_LOCAL  = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD   = 0x06054b50;

export function writeZip(srcDir, zipPath) {
  return new Promise((resolve, reject) => {
    const files = collectFiles(srcDir);
    const entries = files.map((fp) => {
      const name = relative(srcDir, fp).replaceAll("\\", "/");
      const data = readFileSync(fp);
      const crc = crc32(data);
      const comp = data.length > 0 ? deflateRawSync(data, { level: 6 }) : Buffer.alloc(0);
      return { name, data: comp, crc, rawSize: data.length };
    });

    const out = createWriteStream(zipPath);
    out.on("finish", resolve);
    out.on("error", reject);

    const offsets = [];
    let off = 0;
    for (const e of entries) {
      offsets.push(off);
      const nb = Buffer.from(e.name, "utf8");
      const xb = Buffer.alloc(0);
      const h = Buffer.alloc(30);
      h.writeUInt32LE(SIG_LOCAL, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt16LE(0, 6);
      h.writeUInt16LE(e.rawSize > 0 ? 8 : 0, 8);
      h.writeUInt16LE(0, 10); h.writeUInt16LE(0, 12);
      h.writeUInt32LE(e.crc, 14);
      h.writeUInt32LE(e.data.length, 18);
      h.writeUInt32LE(e.rawSize, 22);
      h.writeUInt16LE(nb.length, 26);
      h.writeUInt16LE(xb.length, 28);
      out.write(Buffer.concat([h, nb, xb, e.data]));
      off += 30 + nb.length + xb.length + e.data.length;
    }

    // Central directory
    const centralStart = off;
    let centralSize = 0;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const nb = Buffer.from(e.name, "utf8");
      const xb = Buffer.alloc(0), cb = Buffer.alloc(0);
      const h = Buffer.alloc(46);
      h.writeUInt32LE(SIG_CENTRAL, 0);
      h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6);
      h.writeUInt16LE(0, 8);
      h.writeUInt16LE(e.rawSize > 0 ? 8 : 0, 10);
      h.writeUInt16LE(0, 12); h.writeUInt16LE(0, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.data.length, 20);
      h.writeUInt32LE(e.rawSize, 24);
      h.writeUInt16LE(nb.length, 28);
      h.writeUInt16LE(xb.length, 30);
      h.writeUInt16LE(cb.length, 32);
      h.writeUInt16LE(0, 34); h.writeUInt16LE(0, 36);
      h.writeUInt32LE(0, 38);
      h.writeUInt32LE(offsets[i], 42);
      out.write(Buffer.concat([h, nb, xb, cb]));
      centralSize += 46 + nb.length + xb.length + cb.length;
    }

    // EOCD
    const ec = Buffer.alloc(22);
    ec.writeUInt32LE(SIG_EOCD, 0);
    ec.writeUInt16LE(0, 4); ec.writeUInt16LE(0, 6);
    ec.writeUInt16LE(entries.length, 8);
    ec.writeUInt16LE(entries.length, 10);
    ec.writeUInt32LE(centralSize, 12);
    ec.writeUInt32LE(centralStart, 16);
    ec.writeUInt16LE(0, 20);
    out.write(ec);
    out.end();
  });
}

function collectFiles(dir) {
  const r = [];
  (function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const fp = join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.isFile()) r.push(fp);
    }
  })(dir);
  return r.sort();
}

function crc32(d) {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) {
    c ^= d[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
