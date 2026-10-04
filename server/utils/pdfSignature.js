const crypto = require('crypto')

// Reads the digital signatures of a PDF (PNPKI, Adobe, and other CMS signatures) and checks each one:
// the signer's certificate signed it, and the bytes it covers are unchanged. No outside library.
const OIDS = {
  signedData: '1.2.840.113549.1.7.2',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
}
const DIGESTS = {
  '1.3.14.3.2.26': 'sha1', '2.16.840.1.101.3.4.2.1': 'sha256', '2.16.840.1.101.3.4.2.2': 'sha384', '2.16.840.1.101.3.4.2.3': 'sha512',
}
// Signature algorithms the check supports, and the digest each one implies (null: the signer's digest algorithm).
const SIGNATURES = {
  '1.2.840.113549.1.1.1': null, '1.2.840.113549.1.1.5': 'sha1', '1.2.840.113549.1.1.11': 'sha256', '1.2.840.113549.1.1.12': 'sha384',
  '1.2.840.113549.1.1.13': 'sha512', '1.2.840.10045.4.3.2': 'sha256', '1.2.840.10045.4.3.3': 'sha384', '1.2.840.10045.4.3.4': 'sha512',
}

// One DER (or BER) element at `pos`: its tag, where its content starts and ends, and its whole bytes.
function el(buf, pos) {
  const tag = buf[pos]
  let len = buf[pos + 1]
  let start = pos + 2
  // BER's indefinite length: the content runs until an end-of-contents marker (00 00).
  if (len === 0x80) {
    let p = start
    while (!(buf[p] === 0 && buf[p + 1] === 0)) { if (p >= buf.length) throw new Error('truncated'); p = el(buf, p).next }
    return { tag, start, end: p, next: p + 2, raw: buf.subarray(pos, p + 2) }
  }
  if (len & 0x80) {
    const n = len & 0x7f
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + buf[start + i]
    start += n
  }
  if (start + len > buf.length) throw new Error('truncated')
  return { tag, start, end: start + len, next: start + len, raw: buf.subarray(pos, start + len) }
}
// The elements inside a constructed element.
function kids(buf, parent) {
  const out = []
  for (let p = parent.start; p < parent.end;) { const c = el(buf, p); out.push(c); p = c.next }
  return out
}
function oidOf(buf, e) {
  const b = buf.subarray(e.start, e.end)
  const parts = [Math.floor(b[0] / 40), b[0] % 40]
  let v = 0
  for (let i = 1; i < b.length; i++) { v = v * 128 + (b[i] & 0x7f); if (!(b[i] & 0x80)) { parts.push(v); v = 0 } }
  return parts.join('.')
}
const hexOf = (buf, e) => buf.subarray(e.start, e.end).toString('hex').replace(/^(00)+(?=.)/, '').toUpperCase()
// UTCTime (YYMMDDhhmmssZ) or GeneralizedTime (YYYYMMDDhhmmssZ) as a Date.
function timeOf(buf, e) {
  const s = buf.subarray(e.start, e.end).toString('latin1')
  const full = e.tag === 0x17 ? `${Number(s.slice(0, 2)) < 50 ? '20' : '19'}${s}` : s
  const d = new Date(Date.UTC(+full.slice(0, 4), +full.slice(4, 6) - 1, +full.slice(6, 8), +full.slice(8, 10), +full.slice(10, 12), +full.slice(12, 14)))
  return Number.isNaN(d.getTime()) ? null : d
}
const cn = (dn) => /(?:^|\n)CN=([^\n]+)/.exec(dn || '')?.[1]?.trim() || (dn || '').split('\n')[0] || null

// Checks one CMS (PKCS #7) signature over `content`; returns who signed it and whether it holds.
function checkCms(der, content) {
  const info = el(der, 0)
  const [type, wrapped] = kids(der, info)
  if (oidOf(der, type) !== OIDS.signedData) throw new Error('not a CMS signature')
  const signedData = kids(der, kids(der, wrapped)[0])
  const certs = signedData.filter(e => e.tag === 0xa0).flatMap(e => kids(der, e)).map(c => { try { return new crypto.X509Certificate(c.raw) } catch { return null } }).filter(Boolean)
  const signerInfos = signedData.filter(e => e.tag === 0x31).pop()
  const signer = kids(der, kids(der, signerInfos)[0])
  // SignerInfo: version, sid, digestAlgorithm, [0] signedAttrs?, signatureAlgorithm, signature
  const sid = signer[1]
  const digestOid = oidOf(der, kids(der, signer[2])[0])
  const attrs = signer[3].tag === 0xa0 ? signer[3] : null
  const sigAlg = signer[attrs ? 4 : 3]
  const signature = signer[attrs ? 5 : 4]
  const sigOid = oidOf(der, kids(der, sigAlg)[0])
  const digest = DIGESTS[digestOid]
  if (!digest || !(sigOid in SIGNATURES)) return { supported: false }

  if (!certs.length) return { supported: true, valid: false, problem: 'The signature carries no certificate' }
  // The signer's certificate: the one its serial number names first, then any other that verifies.
  const serial = sid.tag === 0x30 ? hexOf(der, kids(der, sid)[1]) : null
  const ordered = [...certs].sort((x, y) => (y.serialNumber.replace(/^0+(?=.)/, '').toUpperCase() === serial) - (x.serialNumber.replace(/^0+(?=.)/, '').toUpperCase() === serial))

  let signedAt = null
  let digestOk = true
  let data = content
  if (attrs) {
    for (const a of kids(der, attrs)) {
      const [t, values] = kids(der, a)
      const v = kids(der, values)[0]
      if (oidOf(der, t) === OIDS.messageDigest) digestOk = der.subarray(v.start, v.end).equals(crypto.createHash(digest).update(content).digest())
      if (oidOf(der, t) === OIDS.signingTime) signedAt = timeOf(der, v)
    }
    // The signature covers the attributes, re-tagged as the SET they are.
    data = Buffer.concat([Buffer.from([0x31]), attrs.raw.subarray(1)])
  }
  const hash = SIGNATURES[sigOid] || digest
  const verifies = (c) => { try { return crypto.verify(hash, data, { key: c.publicKey, dsaEncoding: 'der' }, der.subarray(signature.start, signature.end)) } catch { return false } }
  const cert = ordered.find(verifies) || ordered[0]
  const sigOk = verifies(cert)
  return {
    supported: true,
    valid: digestOk && sigOk,
    problem: !digestOk ? 'The file was changed after it was signed' : !sigOk ? 'The signature does not match its certificate' : null,
    signer: cn(cert.subject), issuer: cn(cert.issuer),
    self_signed: cert.subject === cert.issuer,
    signed_at: signedAt,
    cert_valid_then: !signedAt || (signedAt >= new Date(cert.validFrom) && signedAt <= new Date(cert.validTo)),
  }
}

// Every signature in a PDF, in file order, each with its checks; the last one must cover the whole file.
function readPdfSignatures(buf) {
  const text = buf.toString('latin1')
  const found = []
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g
  for (let m; (m = re.exec(text));) {
    const [a, b, c, d] = m.slice(1).map(Number)
    if (a !== 0 || a + b > c || c + d > buf.length) continue
    // The dictionary around it says what kind of signature this is (a document timestamp is not a person's).
    const near = text.slice(Math.max(0, m.index - 600), m.index + 600) + text.slice(c, Math.min(c + 600, text.length))
    const subFilter = /\/SubFilter\s*\/([\w.]+)/.exec(near)?.[1] || ''
    if (/RFC3161/i.test(subFilter) || /\/Type\s*\/DocTimeStamp/.test(near)) continue
    // It covers the whole file when nothing but line breaks follows the signed bytes.
    const range = { a, b, c, d, whole: !text.slice(c + d).trim() }
    const hex = text.slice(a + b, c).replace(/[<>\s]/g, '')
    try {
      const checked = /pkcs7\.detached|CAdES\.detached/i.test(subFilter) || !subFilter
        ? checkCms(Buffer.from(hex, 'hex'), Buffer.concat([buf.subarray(a, a + b), buf.subarray(c, c + d)]))
        : { supported: false }
      found.push({ ...checked, range })
    } catch {
      found.push({ supported: false, range })
    }
  }
  return found.map((s, k) => ({
    signer: s.signer || null, issuer: s.issuer || null, self_signed: !!s.self_signed,
    signed_at: s.signed_at ? s.signed_at.toISOString() : null,
    valid: s.supported ? s.valid : null,
    covers_file: s.range.whole,
    problem: !s.supported ? 'This kind of signature can\'t be checked'
      : s.problem || (k === found.length - 1 && !s.range.whole ? 'The file was changed after it was signed' : null)
        || (!s.cert_valid_then ? 'The certificate was not valid when it signed' : null),
  }))
}

// Whether a PDF is digitally signed and unchanged: at least one signature, none failing, the last covering the whole file.
function pdfSigned(signatures) {
  return signatures.length > 0 && signatures.every(s => s.valid && !s.problem)
}

module.exports = { readPdfSignatures, pdfSigned }
