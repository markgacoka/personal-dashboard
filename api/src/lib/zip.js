import { inflateRawSync } from 'zlib'

// Reads one file out of an in-memory zip archive (stored or deflated entries).
export function readZipEntry(buf, filename) {
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) throw new Error('Not a zip archive')
  const entries = buf.readUInt16LE(eocd + 10)
  let pos = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < entries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break
    const method = buf.readUInt16LE(pos + 10)
    const size = buf.readUInt32LE(pos + 20)
    const fnLen = buf.readUInt16LE(pos + 28), extraLen = buf.readUInt16LE(pos + 30), commentLen = buf.readUInt16LE(pos + 32)
    const local = buf.readUInt32LE(pos + 42)
    const name = buf.subarray(pos + 46, pos + 46 + fnLen).toString('utf8')
    if (name === filename) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + size)
      if (method === 0) return Buffer.from(data)
      if (method === 8) return inflateRawSync(data)
      throw new Error(`Unsupported compression ${method} for ${filename}`)
    }
    pos += 46 + fnLen + extraLen + commentLen
  }
  throw new Error(`${filename} not found in zip`)
}
