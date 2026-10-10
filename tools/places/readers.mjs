// Readers for the two file formats the Gazetteer's downloads come in: a ZIP
// archive holding a shapefile, whose attribute table (.dbf, dBase III) has
// everything the catalogues need (name, type, diameter, centre).  No
// dependencies: node's zlib inflates the ZIP's entries.
import {inflateRawSync} from 'node:zlib'


const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50


/**
 * @param {Buffer} buf A ZIP archive
 * @returns {Map<string, Buffer>} Each file's name to its contents
 */
export function readZip(buf) {
  // The end-of-central-directory record is in the last 64 KB + 22 bytes.
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) {
    throw new Error('not a ZIP archive: no end-of-central-directory record')
  }
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const files = new Map
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CENTRAL_SIG) {
      throw new Error('bad central directory entry')
    }
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    if (buf.readUInt32LE(local) !== LOCAL_SIG) {
      throw new Error(`bad local header for ${name}`)
    }
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(start, start + compSize)
    if (method === 0) {
      files.set(name, Buffer.from(data))
    } else if (method === 8) {
      files.set(name, inflateRawSync(data))
    } else {
      throw new Error(`${name}: unsupported ZIP method ${method}`)
    }
  }
  return files
}


/**
 * @param {Buffer} buf A dBase III table (.dbf)
 * @param {string} [encoding] The text encoding (the shapefile's .cpg says)
 * @returns {Array<{[field: string]: string}>} The rows, each field a trimmed
 *   string
 */
export function readDbf(buf, encoding = 'utf8') {
  const count = buf.readUInt32LE(4)
  const headerLen = buf.readUInt16LE(8)
  const recordLen = buf.readUInt16LE(10)
  const fields = []
  for (let o = 32; buf[o] !== 0x0d; o += 32) {
    const name = buf.toString('latin1', o, o + 11).split('\0')[0]
    fields.push({name, len: buf[o + 16]})
  }
  const decoder = new TextDecoder(encoding)
  const rows = []
  for (let i = 0; i < count; i++) {
    let p = headerLen + (i * recordLen)
    if (buf[p] === 0x2a) { // deleted
      continue
    }
    p++
    const row = {}
    for (const {name, len} of fields) {
      row[name] = decoder.decode(buf.subarray(p, p + len)).trim()
      p += len
    }
    rows.push(row)
  }
  return rows
}
