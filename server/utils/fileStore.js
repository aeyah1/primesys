const fs     = require('fs')
const path   = require('path')
const config = require('../config')

// Uploaded files live in server/uploads/<dir>, or in a private Supabase Storage bucket when SUPABASE_URL is set.
const LOCAL = path.join(__dirname, '..', 'uploads')
const { url, key, bucket } = config.storage
const remote = Boolean(url)

// New sb_secret_ keys go only in the apikey header; older JWT keys also go in Authorization.
const auth = key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key }
const objectUrl = (dir, name) => `${url}/storage/v1/object/${bucket}/${dir}/${name}`

// Moves a file multer saved to disk into the bucket; on local disk it is already where it belongs.
async function keep(dir, file) {
  if (!remote) return
  try {
    const res = await fetch(objectUrl(dir, file.filename), {
      method:  'POST',
      headers: { ...auth, 'content-type': file.mimetype },
      body:    await fs.promises.readFile(file.path),
      signal:  AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`Storage upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  } finally {
    fs.unlink(file.path, () => {})
  }
}

// Sends a stored file as a download, or a 404 when it is missing.
async function send(res, dir, name, downloadName) {
  if (!remote) {
    const filePath = path.join(LOCAL, dir, name)
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File not found on disk' })
    return res.download(filePath, downloadName)
  }
  const stored = await fetch(objectUrl(dir, name), { headers: auth, signal: AbortSignal.timeout(30_000) })
  if (stored.status === 400 || stored.status === 404) return res.status(404).json({ message: 'File not found' })
  if (!stored.ok) throw new Error(`Storage download failed (${stored.status})`)
  res.attachment(downloadName).send(Buffer.from(await stored.arrayBuffer()))
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

module.exports = { keep, send, remove }
