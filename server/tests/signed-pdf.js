// Builds digitally signed PDFs for tests: a certificate, a CMS (PKCS #7) signature, and the
// signature added to a PDF as an incremental update, the way signing software adds one.
const crypto = require('crypto')

// DER encoding, just enough for certificates and CMS.
const len = (n) => {
  if (n < 128) return Buffer.from([n])
  const b = []
  for (let x = n; x; x = Math.floor(x / 256)) b.unshift(x & 255)
  return Buffer.from([0x80 | b.length, ...b])
}
const tlv = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), len(body.length), body]) }
const seq = (...p) => tlv(0x30, ...p)
const set = (...p) => tlv(0x31, ...p)
const ctx = (n, ...p) => tlv(0xa0 + n, ...p)
const nul = () => Buffer.from([0x05, 0x00])
const octet = (b) => tlv(0x04, b)
const bits = (b) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]))
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'))
const utc = (d) => tlv(0x17, Buffer.from(`${d.toISOString().replace(/[-:T]/g, '').slice(2, 14)}Z`))
const int = (hex) => { let b = Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex'); if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); return tlv(0x02, b) }
const oid = (s) => {
  const p = s.split('.').map(Number)
  const out = [p[0] * 40 + p[1]]
  for (const v of p.slice(2)) { const b = [v & 127]; for (let x = v >> 7; x; x >>= 7) b.unshift((x & 127) | 128); out.push(...b) }
  return tlv(0x06, Buffer.from(out))
}
const name = (cn) => seq(set(seq(oid('2.5.4.3'), utf8(cn))))
const SHA256 = '2.16.840.1.101.3.4.2.1'
const SHA256_RSA = '1.2.840.113549.1.1.11'

// A certificate for `cn`, issued by `issuer` (another certificate) or by itself.
function makeCert(cn, { issuer = null, days = 365 } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const serial = crypto.randomBytes(8).toString('hex').replace(/^0/, '1')
  const now = Date.now()
  const tbs = seq(ctx(0, int('02')), int(serial), seq(oid(SHA256_RSA), nul()), name(issuer ? issuer.cn : cn),
    seq(utc(new Date(now - 864e5)), utc(new Date(now + days * 864e5))), name(cn), publicKey.export({ type: 'spki', format: 'der' }))
  const der = seq(tbs, seq(oid(SHA256_RSA), nul()), bits(crypto.sign('sha256', tbs, issuer ? issuer.privateKey : privateKey)))
  return { cn, serial, der, privateKey, issuerCn: issuer ? issuer.cn : cn }
}

// A detached CMS signature over `content` by `cert`, with the certificates it carries; `ber` writes its outer length open-ended, as some signers do.
function cms(content, cert, chain = [], { ber = false } = {}) {
  const attrs = [
    seq(oid('1.2.840.113549.1.9.3'), set(oid('1.2.840.113549.1.7.1'))),
    seq(oid('1.2.840.113549.1.9.5'), set(utc(new Date()))),
    seq(oid('1.2.840.113549.1.9.4'), set(octet(crypto.createHash('sha256').update(content).digest()))),
  ]
  const signature = crypto.sign('sha256', set(...attrs), cert.privateKey)
  const signer = seq(int('01'), seq(name(cert.issuerCn), int(cert.serial)), seq(oid(SHA256), nul()), ctx(0, ...attrs),
    seq(oid('1.2.840.113549.1.1.1'), nul()), octet(signature))
  const signedData = seq(int('01'), set(seq(oid(SHA256), nul())), seq(oid('1.2.840.113549.1.7.1')),
    ctx(0, cert.der, ...chain.map(c => c.der)), set(signer))
  const inner = [oid('1.2.840.113549.1.7.2'), ctx(0, signedData)]
  return ber ? Buffer.concat([Buffer.from([0x30, 0x80]), ...inner, Buffer.from([0, 0])]) : seq(...inner)
}

// A one-page PDF with a line of text, written with a classic cross-reference table.
function plainPdf(text = 'PROJECT PROCUREMENT MANAGEMENT PLAN') {
  const stream = `BT /F1 14 Tf 72 720 Td (${text.replace(/[()\\]/g, '')}) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.7\n'
  const offsets = objs.map((o, k) => { const at = out.length; out += `${k + 1} 0 obj\n${o}\nendobj\n`; return at })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

// The PDF with a signature by `cert` added as an incremental update (catalog, first page, field, and signature).
function signPdf(pdf, cert, { chain = [], reason = 'Approved', ber = false } = {}) {
  const text = pdf.toString('latin1')
  const trailer = text.slice(text.lastIndexOf('trailer'))
  const root = Number(/\/Root\s+(\d+)\s+0\s+R/.exec(trailer)[1])
  const size = Number(/\/Size\s+(\d+)/.exec(trailer)[1])
  const prev = Number(/startxref\s+(\d+)\s*%%EOF\s*$/.exec(text)[1])
  const body = (n) => { const m = new RegExp(`(?:^|\\s)${n}\\s+0\\s+obj\\s*([\\s\\S]*?)\\s*endobj`).exec(text); return m[1] }
  const catalog = body(root)
  const pages = Number(/\/Pages\s+(\d+)\s+0\s+R/.exec(catalog)[1])
  const page = Number(/\/Kids\s*\[\s*(\d+)\s+0\s+R/.exec(body(pages))[1])
  const field = size
  const sig = size + 1
  const dictEnd = (d, add) => d.replace(/>>\s*$/, `${add} >>`)
  const pageBody = body(page)
  const objects = [
    [root, dictEnd(catalog, ` /AcroForm << /Fields [${field} 0 R] /SigFlags 3 >>`)],
    [page, /\/Annots\s*\[/.test(pageBody) ? pageBody.replace(/\/Annots\s*\[/, `/Annots [${field} 0 R `) : dictEnd(pageBody, ` /Annots [${field} 0 R]`)],
    [field, `<< /Type /Annot /Subtype /Widget /FT /Sig /F 132 /T (Signature1) /Rect [0 0 0 0] /P ${page} 0 R /V ${sig} 0 R >>`],
    [sig, `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /Name (${cert.cn}) /Reason (${reason}) /M (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) /ByteRange [0 ********** ********** **********] /Contents <${'0'.repeat(16384)}> >>`],
  ]
  let out = text.endsWith('\n') ? '' : '\n'
  const offsets = objects.map(([n, o]) => { const at = pdf.length + Buffer.byteLength(out, 'latin1'); out += `${n} 0 obj\n${o}\nendobj\n`; return [n, at] })
  const xref = pdf.length + Buffer.byteLength(out, 'latin1')
  out += `xref\n0 1\n0000000000 65535 f \n${offsets.map(([n, at]) => `${n} 1\n${String(at).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${size + 2} /Root ${root} 0 R /Prev ${prev} >>\nstartxref\n${xref}\n%%EOF\n`
  const full = Buffer.concat([pdf, Buffer.from(out, 'latin1')])
  // Fill in what the signature covers (everything but its own hex), then the signature itself.
  const s = full.toString('latin1')
  const brAt = s.lastIndexOf('/ByteRange [0 **********')
  const open = s.indexOf('/Contents <', brAt) + '/Contents '.length
  const close = s.indexOf('>', open) + 1
  const range = `0 ${open} ${close} ${full.length - close}`
  full.write(`/ByteRange [${range}]`.padEnd('/ByteRange [0 ********** ********** **********]'.length, ' '), brAt, 'latin1')
  const signature = cms(Buffer.concat([full.subarray(0, open), full.subarray(close)]), cert, chain, { ber }).toString('hex')
  if (signature.length > 16384) throw new Error('signature too large for its placeholder')
  full.write(signature, open + 1, 'latin1')
  return full
}

module.exports = { makeCert, cms, plainPdf, signPdf }
