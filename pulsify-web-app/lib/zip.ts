// Minimal, dependency-free ZIP writer (store / no-compression).
//
// The asset-export route bundles already-compressed media (PNG/GIF/MP3) plus a
// small JSON manifest, so compression would buy almost nothing — a "stored"
// archive is both simpler and avoids pulling in a zip dependency. Runs on the
// server with Node Buffers; the output Buffer is streamed straight to the
// browser as a .zip download.

type ZipEntry = { name: string; data: Buffer }

// Standard CRC-32 (IEEE 802.3) — required by the ZIP format for each entry.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// DOS date/time stamp for the current moment (ZIP stores local time this way).
function dosDateTime(d = new Date()): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2))
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

/**
 * Build a stored (uncompressed) ZIP from the given entries. Filenames are
 * encoded UTF-8 with the language-encoding flag set so non-ASCII names survive.
 */
export function buildZip(entries: ZipEntry[]): Buffer {
  const { time, date } = dosDateTime()
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const crc = crc32(entry.data)
    const size = entry.data.length

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // local file header signature
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // flags: UTF-8 filename
    local.writeUInt16LE(0, 8) // method: store
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(size, 18) // compressed size
    local.writeUInt32LE(size, 22) // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra length
    localParts.push(local, nameBuf, entry.data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0) // central directory header signature
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8) // flags: UTF-8 filename
    central.writeUInt16LE(0, 10) // method: store
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(size, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra length
    central.writeUInt16LE(0, 32) // comment length
    central.writeUInt16LE(0, 34) // disk number
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42) // local header offset
    centralParts.push(central, nameBuf)

    offset += local.length + nameBuf.length + entry.data.length
  }

  const centralDir = Buffer.concat(centralParts)
  const centralSize = centralDir.length
  const centralOffset = offset

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0) // end of central directory signature
  end.writeUInt16LE(0, 4) // disk number
  end.writeUInt16LE(0, 6) // central dir start disk
  end.writeUInt16LE(entries.length, 8) // entries on this disk
  end.writeUInt16LE(entries.length, 10) // total entries
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralOffset, 16)
  end.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...localParts, centralDir, end])
}
