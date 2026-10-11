// What the BAC's award is recorded on: a request whose approved budget (its items not dropped) is at or above
// the resolution threshold (50,000 by default) is awarded in a numbered BAC Resolution; below it on the Abstract
// of sealed Quotations alone, still with its Notice of Award. Real HTTP against a throwaway database.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_award_doc_test_tmp', port: 5143 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 5: 'twg', 6: 'bac' }
const tok  = (id) => jwt.sign({ id }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@award.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  const P = (id, status) => `(${id}, 'PR-D-${id}', 'Award ${id}', '${status}', 3, 'office_supplies', 'Shopping')`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES ${[1, 2, 3, 5, 6].map(U).join(', ')};
    ${H.twgAreas([5], ['office_supplies'])}
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category, mode_of_procurement) VALUES
      ${P(90, 'bidding')}, ${P(91, 'bidding')}, ${P(92, 'bidding')}, ${P(93, 'bidding')}, ${P(94, 'bac_review')};
    INSERT INTO pr_items (id, pr_id, item_name, quantity, unit, estimated_cost, dropped_at) VALUES
      (901, 90, 'Laptop', 1, 'unit', 49999.99, NULL),
      (911, 91, 'Printer', 2, 'unit', 25000, NULL),
      (921, 92, 'Scanner', 1, 'unit', 40000, NULL), (922, 92, 'Plotter', 1, 'unit', 20000, NOW()),
      (931, 93, 'Projector', 1, 'unit', 30000, NULL),
      (941, 94, 'Cabinet', 1, 'unit', 12000, NULL);
    SET FOREIGN_KEY_CHECKS = 1;
  `
}
async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  const raw = Buffer.from(await res.arrayBuffer())
  return { status: res.status, type, raw, file: res.headers.get('content-disposition') || '', data: type.includes('json') ? JSON.parse(raw.toString()) : null }
}
const awardIt = async (prId, prices) => {
  try { await H.award(BASE, tok, prId, { bac: 6, twg: 5 }, [{ name: 'Alpha Trading', prices }, { name: 'Bravo Supply', prices: Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, v + 100])) }]); return 'ok' } catch (e) { return e.message }
}
const roundOf = async (prId) => (await http(6, 'GET', `/bac/${prId}`)).data?.resolutions?.[0]

async function run() {
  const t = H.suite('AWARD DOCUMENT')
  const is = async (g, label, who, m, p, body, ok) => { const r = await http(who, m, p, body); t.check(g, label, ok(r), `${r.status} ${r.data ? JSON.stringify(r.data) : r.type}`.slice(0, 300)); return r }
  const pdf = (r) => r.status === 200 && r.type.includes('pdf') && r.raw.subarray(0, 4).toString() === '%PDF'

  const A = 'Before the award'
  await is(A, 'the BAC sees what the award will be recorded on', 6, 'GET', '/canvass/94', undefined,
    (r) => r.status === 200 && r.data.award_document?.kind === 'abstract' && r.data.award_document.abc === 12000 && r.data.award_document.threshold === 50000)

  const B = 'The 50,000 line'
  t.check(B, 'a request of 49,999.99 is awarded', (await awardIt(90, { 901: 48000 })) === 'ok', '')
  const below = await roundOf(90)
  t.check(B, '…on the Abstract alone, with no resolution number', below?.kind === 'abstract' && below.resolution_number === null, JSON.stringify(below))
  const [log] = await H.sql(TEST_DB, "SELECT note FROM pr_status_logs WHERE pr_id = 90 AND to_status = 'for_po'")
  t.check(B, '…its history says so', log?.note === 'Awarded by the BAC on the Abstract of sealed Quotations', log?.note)
  t.check(B, 'a request of exactly 50,000 is awarded', (await awardIt(91, { 911: 24000 })) === 'ok', '')
  const at = await roundOf(91)
  t.check(B, '…in a numbered BAC Resolution', at?.kind === 'resolution' && /^\d{4}-001$/.test(at.resolution_number || ''), JSON.stringify(at))
  t.check(B, 'items dropped don\'t count: 60,000 less a dropped 20,000 is awarded', (await awardIt(92, { 921: 39000 })) === 'ok', '')
  t.check(B, '…on the Abstract alone', (await roundOf(92))?.kind === 'abstract', '')
  await is(B, 'Procurement is told it was awarded on the Abstract', 2, 'GET', '/notifications', undefined,
    (r) => r.status === 200 && r.data.some(n => n.message === 'PR PR-D-90 was awarded by the BAC on the Abstract of sealed Quotations. The purchase orders can be issued.'))

  const C = 'The documents'
  await is(C, 'an Abstract award has no BAC Resolution to print (404)', 6, 'GET', `/bac/90/resolutions/${below?.id}/pdf`, undefined, (r) => r.status === 404)
  await is(C, '…its Abstract of sealed Quotations prints, landscape', 6, 'GET', `/bac/90/resolutions/${below?.id}/abstract`, undefined,
    (r) => pdf(r) && /Abstract-of-Quotations-PR-D-90-\d{4}-\d{2}-\d{2}\.pdf/.test(r.file) && r.raw.toString('latin1').includes('/MediaBox [0 0 792 612]'))
  await is(C, '…and its Notice of Award, named by its date', 6, 'GET', `/bac/90/resolutions/${below?.id}/notice/${below?.lots?.[0]?.id}`, undefined,
    (r) => pdf(r) && /Notice-of-Award-\d{4}-\d{2}-\d{2}-Alpha-Trading\.pdf/.test(r.file))
  await is(C, 'a resolution award prints its BAC Resolution', 2, 'GET', `/bac/91/resolutions/${at?.id}/pdf`, undefined, pdf)
  await is(C, '…and its Abstract too', 2, 'GET', `/bac/91/resolutions/${at?.id}/abstract`, undefined, pdf)
  await is(C, 'an End User can\'t print the Abstract (403)', 3, 'GET', `/bac/90/resolutions/${below?.id}/abstract`, undefined, (r) => r.status === 403)
  await is(C, 'the BAC\'s list shows each award\'s kind', 6, 'GET', '/bac/queue?view=approved', undefined,
    (r) => r.status === 200 && r.data.data.map(x => `${x.pr_number}:${x.kind}`).sort().join() === 'PR-D-90:abstract,PR-D-91:resolution,PR-D-92:abstract')

  const D = 'The threshold setting'
  await is(D, 'not a number → 400', 1, 'PATCH', '/settings', { resolution_threshold: 'fifty' }, (r) => r.status === 400)
  await is(D, 'only an admin sets it (403)', 6, 'PATCH', '/settings', { resolution_threshold: '25000' }, (r) => r.status === 403)
  await is(D, 'the admin lowers it to 25,000', 1, 'PATCH', '/settings', { resolution_threshold: '25000' }, (r) => r.status === 200)
  t.check(D, 'a request of 30,000 is awarded', (await awardIt(93, { 931: 29000 })) === 'ok', '')
  t.check(D, '…in a BAC Resolution now, the next number', /^\d{4}-002$/.test((await roundOf(93))?.resolution_number || ''), JSON.stringify(await roundOf(93)))

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
