// Digital signatures on a PDF: who signed it, whether the signature holds, and whether the
// file changed after signing. The PDFs are signed here, the way signing software signs them.
//
// No database and no server: readPdfSignatures is a pure function.
const path = require('path')
const H    = require('./harness')
const { makeCert, plainPdf, signPdf } = require('./signed-pdf')
const { readPdfSignatures, pdfSigned } = require(path.join(H.SERVER, 'utils', 'pdfSignature'))

async function run() {
  const t = H.suite('PDF SIGNATURES')
  const S = 'Signatures'
  const authority = makeCert('Test Certification Authority')
  const head = makeCert('JUAN A. DELA CRUZ', { issuer: authority })
  const self = makeCert('MARIA SANTOS')

  const signed = signPdf(plainPdf(), head, { chain: [authority] })
  const [one] = readPdfSignatures(signed)
  t.check(S, 'a signed PDF names its signer and issuer', one?.signer === 'JUAN A. DELA CRUZ' && one.issuer === 'Test Certification Authority', JSON.stringify(one))
  t.check(S, '…the signature holds and covers the whole file', one.valid === true && one.covers_file === true && one.problem === null && pdfSigned([one]), JSON.stringify(one))
  t.check(S, '…with when it was signed', !!one.signed_at && Math.abs(new Date(one.signed_at) - Date.now()) < 120000, one.signed_at)
  t.check(S, '…and a certificate from an authority is not self-signed', one.self_signed === false)

  const tampered = Buffer.from(signed)
  const at = tampered.indexOf('PROJECT PROCUREMENT')
  tampered.write('X', at, 'latin1')
  const [bad] = readPdfSignatures(tampered)
  t.check(S, 'a byte changed after signing breaks it', bad.valid === false && /changed after it was signed/.test(bad.problem) && !pdfSigned([bad]), JSON.stringify(bad))

  const appended = Buffer.concat([signed, Buffer.from('1 0 obj\n<< /Type /Catalog >>\nendobj\n')])
  const [later] = readPdfSignatures(appended)
  t.check(S, 'content added after signing is caught', later.valid === true && later.covers_file === false && /changed after/.test(later.problem) && !pdfSigned([later]), JSON.stringify(later))

  const [mine] = readPdfSignatures(signPdf(plainPdf(), self))
  t.check(S, 'a self-signed certificate is told apart', mine.valid === true && mine.self_signed === true && mine.signer === 'MARIA SANTOS', JSON.stringify(mine))

  const twice = readPdfSignatures(signPdf(signPdf(plainPdf(), self), head, { chain: [authority] }))
  t.check(S, 'two signers are both read, in order', twice.map(s => s.signer).join() === 'MARIA SANTOS,JUAN A. DELA CRUZ' && pdfSigned(twice),
    JSON.stringify(twice.map(s => [s.signer, s.valid, s.covers_file, s.problem])))

  const [forged] = readPdfSignatures(signPdf(plainPdf(), { ...head, privateKey: self.privateKey }, { chain: [authority] }))
  t.check(S, 'a signature made with another key than its certificate\'s fails', forged.valid === false && /does not match its certificate/.test(forged.problem), JSON.stringify(forged))

  const [open] = readPdfSignatures(signPdf(plainPdf(), head, { chain: [authority], ber: true }))
  t.check(S, 'a signature written with open-ended (BER) lengths is read too', open.valid === true && open.signer === 'JUAN A. DELA CRUZ', JSON.stringify(open))

  t.check(S, 'a PDF without a signature has none', readPdfSignatures(plainPdf()).length === 0 && !pdfSigned([]))
  const broken = Buffer.from(signed)
  broken.write('3082FFFF', broken.indexOf('/Contents <') + 11, 'latin1')
  const [unread] = readPdfSignatures(broken)
  t.check(S, 'a signature that can\'t be read is not taken as signed', unread.valid === null && !pdfSigned([unread]), JSON.stringify(unread))
  t.check(S, 'something that is not a PDF has no signatures', readPdfSignatures(Buffer.from('not a pdf')).length === 0)

  return t.summary()
}

run().then(failed => process.exit(failed ? 1 : 0)).catch(e => { console.error(e); process.exit(1) })
