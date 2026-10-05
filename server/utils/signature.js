const httpError = require('./httpError')

// A signature on a document: a PNG image (data URL) of at most 100 KB, drawn on
// the screen or uploaded as a picture. Anything else is refused.
const PREFIX = 'data:image/png;base64,'
const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
const MAX_BYTES = 100 * 1024
const METHODS = ['drawn', 'uploaded']

// The PNG bytes of a stored signature, or null.
function signatureBuffer(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PREFIX)) return null
  const buf = Buffer.from(dataUrl.slice(PREFIX.length), 'base64')
  return buf.subarray(0, 8).equals(PNG) ? buf : null
}

// Returns the data URL when it is a real PNG within the size limit, else throws 400.
function checkSignature(dataUrl) {
  const buf = signatureBuffer(dataUrl)
  if (!buf) throw httpError(400, 'The signature must be a PNG image')
  if (buf.length > MAX_BYTES) throw httpError(400, 'The signature image is too large (100 KB at most)')
  return `${PREFIX}${buf.toString('base64')}`
}

// The requester's signature sent with a PR: { image, method } to store, null to
// clear it, undefined when the request leaves it as it is.
function requesterSignature(body) {
  if (!('requested_by_signature' in body)) return undefined
  if (!body.requested_by_signature) return null
  return { image: checkSignature(body.requested_by_signature), method: METHODS.includes(body.requested_by_sign_method) ? body.requested_by_sign_method : 'drawn' }
}

module.exports = { METHODS, signatureBuffer, checkSignature, requesterSignature }
