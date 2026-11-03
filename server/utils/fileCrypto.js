const crypto = require('crypto')
const config = require('../config')

// Stored files are encrypted by the server with AES-256-GCM before they are kept, a second layer over the storage's own
// encryption at rest and HTTPS in transit (panel review, 2026-10-26). A kept file reads MAGIC, a 12-byte IV, the 16-byte
// tag, then the ciphertext; a file without MAGIC was stored before encryption and is sent as it is. With no
// FILE_ENCRYPTION_KEY set, new files are stored as they are.

const MAGIC = Buffer.from('PRSENC1\n')
const KEY = config.storage.fileKey ? Buffer.from(config.storage.fileKey, 'hex') : null
const IV = 12
const TAG = 16

const enabled = () => KEY !== null
const isEncrypted = (buf) => buf.length >= MAGIC.length + IV + TAG && buf.subarray(0, MAGIC.length).equals(MAGIC)

// The file to keep: encrypted when a key is set and it is not already.
function encrypt(buf) {
  if (!KEY || isEncrypted(buf)) return buf
  const iv = crypto.randomBytes(IV)
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  const body = Buffer.concat([cipher.update(buf), cipher.final()])
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body])
}

// The file as uploaded; throws when it is encrypted but no key is set, or when it was altered (the tag fails).
function decrypt(buf) {
  if (!isEncrypted(buf)) return buf
  if (!KEY) throw new Error('This file is encrypted, but FILE_ENCRYPTION_KEY is not set')
  const iv = buf.subarray(MAGIC.length, MAGIC.length + IV)
  const tag = buf.subarray(MAGIC.length + IV, MAGIC.length + IV + TAG)
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(buf.subarray(MAGIC.length + IV + TAG)), decipher.final()])
}

module.exports = { enabled, isEncrypted, encrypt, decrypt }
