const fs     = require('fs')
const path   = require('path')
const config = require('../config')
const fileCrypto = require('./fileCrypto')

// Uploaded files live in server/uploads/<dir>, or in a private Supabase Storage bucket when SUPABASE_URL is set.
// Every file is kept encrypted when FILE_ENCRYPTION_KEY is set (utils/fileCrypto.js) and handed out decrypted.
const LOCAL = path.join(__dirname, '..', 'uploads')
const { url, key, bucket } = config.storage
const remote = Boolean(url)

// New sb_secret_ keys go only in the apikey header; older JWT keys also go in Authorization.
const auth = key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key }
const objectUrl = (dir, name) => `${url}/storage/v1/object/${bucket}/${dir}/${name}`

// Puts `body` in the bucket as dir/name; `replace` overwrites one already there.
async function put(dir, name, body, type, replace = false) {
  const res = await fetch(objectUrl(dir, name), {
    method:  'POST',
    headers: { ...auth, 'content-type': type, ...(replace && { 'x-upsert': 'true' }) },
    body,
    signal:  AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Storage upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
}

// Keeps a file multer saved to disk: encrypted in place on local disk, or encrypted and moved into the bucket.
async function keep(dir, file) {
  if (!remote && !fileCrypto.enabled()) return
  try {
    const kept = fileCrypto.encrypt(await fs.promises.readFile(file.path))
    if (!remote) return await fs.promises.writeFile(file.path, kept)
    await put(dir, file.filename, kept, fileCrypto.enabled() ? 'application/octet-stream' : file.mimetype)
  } finally {
    if (remote) fs.unlink(file.path, () => {})
  }
}

// A stored file's contents as kept (maybe encrypted), or null when it is missing.
async function readStored(dir, name) {
  if (!remote) {
    const filePath = path.join(LOCAL, dir, name)
    return fs.existsSync(filePath) ? fs.promises.readFile(filePath) : null
  }
  const stored = await fetch(objectUrl(dir, name), { headers: auth, signal: AbortSignal.timeout(30_000) })
  if (stored.status === 400 || stored.status === 404) return null
  if (!stored.ok) throw new Error(`Storage download failed (${stored.status})`)
  return Buffer.from(await stored.arrayBuffer())
}

// A stored file's contents as uploaded, or null when it is missing.
async function read(dir, name) {
  const stored = await readStored(dir, name)
  return stored && fileCrypto.decrypt(stored)
}

// Sends a stored file as a download, or a 404 when it is missing.
async function send(res, dir, name, downloadName) {
  const contents = await read(dir, name)
  if (!contents) return res.status(404).json({ message: remote ? 'File not found' : 'File not found on disk' })
  res.attachment(downloadName).send(contents)
}

// Encrypts a file kept before encryption was on; true when it did (server/db/encrypt_stored_files.js).
async function seal(dir, name) {
  if (!fileCrypto.enabled()) throw new Error('Set FILE_ENCRYPTION_KEY first')
  const stored = await readStored(dir, name)
  if (!stored || fileCrypto.isEncrypted(stored)) return false
  const kept = fileCrypto.encrypt(stored)
  if (!remote) await fs.promises.writeFile(path.join(LOCAL, dir, name), kept)
  else await put(dir, name, kept, 'application/octet-stream', true)
  return true
}

// Deletes a stored file in the background; a failure is only logged, since its row is already gone.
function remove(dir, name) {
  if (!remote) return fs.unlink(path.join(LOCAL, dir, name), () => {})
  fetch(`${url}/storage/v1/object/${bucket}`, {
    method:  'DELETE',
    headers: { ...auth, 'content-type': 'application/json' },
    body:    JSON.stringify({ prefixes: [`${dir}/${name}`] }),
    signal:  AbortSignal.timeout(30_000),
  })
    .then(res => { if (!res.ok) console.error(`[storage] delete of ${dir}/${name} failed (${res.status})`) })
    .catch(err => console.error(`[storage] delete of ${dir}/${name} failed: ${err.message}`))
}

module.exports = { keep, send, read, seal, remove }
