// An invited supplier who won't quote: Procurement records it (with why), the
// supplier's link stops taking a quotation, no reminder or new link goes to it,
// and the quotations can close early once everyone has quoted or declined.
// Real HTTP against a throwaway database, with emails captured.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_rfq_decline_test_tmp', port: 5126 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'twg' }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const MAIL = []
const pad  = (n) => String(n).padStart(2, '0')
const inDays = (n) => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` }
const tokenIn = (m) => (m?.html.match(/\/quote\/([0-9a-f]{64})/) || [])[1]

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@decline.invalid', '${hash}', '${ROLE[id]}', 1, 1)`
  const year = new Date().getFullYear()
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified) VALUES ${Object.keys(ROLE).map(U).join(', ')};
    INSERT INTO quarters (id, label, year, start_date, end_date, is_active) VALUES (1, 'Q1', ${year}, '${year}-01-01', '${year}-12-31', 1);
    INSERT INTO org_settings (setting_key, setting_value) VALUES ('minimum_quotations', '1');
    ${H.twgAreas([4])}
    -- Requests are filed for an office and drawn from its verified PPMP (utils/ppmpUse.js).
    INSERT INTO departments (id, code, name) VALUES (90, 'TST', 'Test Office');
    UPDATE users SET department_id = 90 WHERE department_id IS NULL;
    UPDATE purchase_requests SET department_id = 90 WHERE department_id IS NULL;
    ${H.ppmpFor(90, ['Chair'])}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = who ? { Authorization: `Bearer ${tok(who)}` } : {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, data: type.includes('json') ? await res.json() : null }
}
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 260)

async function run() {
  const t = H.suite('RFQ DECLINED')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }
  const must = async (who, m, p, body) => {
    const r = await http(who, m, p, body)
    if (r.status >= 400) throw new Error(`${m} ${p} -> ${show(r)}`)
    return r.data
  }
  const S = (name) => ({ name, email: `${name.split(' ')[0].toLowerCase()}@x.invalid`, contact_person: 'A', phone: '0917 123 4567', address: 'Cantilan' })
  const alpha = (await must(2, 'POST', '/suppliers', S('Alpha Store'))).id
  const beta  = (await must(2, 'POST', '/suppliers', S('Beta Store'))).id
  const approved = async (title) => {
    const id = (await must(2, 'POST', '/pr', { title, items: [{ item_name: 'Chair', quantity: 5, estimated_cost: 1500 }] })).id
    await must(2, 'PATCH', `/pr/${id}/status`, { status: 'submitted' })
    await must(4, 'POST', `/twg/${id}/review`, { action: 'approve' })
    return id
  }
  const invOf = async (pr, name) => (await must(2, 'GET', `/canvass/${pr}`)).rfq.invitations.find(i => i.supplier_name === name)

  const pr = await approved('Chairs')
  MAIL.length = 0
  await must(2, 'POST', `/canvass/${pr}/open`, { mode_of_procurement: 'Shopping', deadline: inDays(3), supplier_ids: [alpha, beta] })
  const alphaTok = tokenIn(MAIL.find(m => m.to === 'alpha@x.invalid'))
  const betaTok  = tokenIn(MAIL.find(m => m.to === 'beta@x.invalid'))
  const chair = (await must(2, 'GET', `/canvass/${pr}`)).items[0].id
  await must(null, 'POST', `/public/quote/${alphaTok}`, { prices: [{ item: chair, unit_price: 1400 }] })
  const aInv = await invOf(pr, 'Alpha Store'), bInv = await invOf(pr, 'Beta Store')

  // ── Recording a decline ──────────────────────────────────────────────
  const D = 'Declining'
  await is(D, 'closing early is refused while Beta has neither quoted nor declined', 2, 'POST', `/canvass/${pr}/rfq/close`, undefined,
    r => r.status === 409 && /Beta Store has not quoted or declined yet/.test(r.data.message), '409')
  await is(D, 'the requestor can\'t mark a decline', 3, 'POST', `/canvass/${pr}/rfq/${bInv.id}/decline`, { reason: 'x' }, r => r.status === 403, '403')
  await is(D, 'a reason is required', 2, 'POST', `/canvass/${pr}/rfq/${bInv.id}/decline`, { reason: '  ' }, r => r.status === 400, '400')
  await is(D, 'a supplier that quoted can\'t be marked as declined', 2, 'POST', `/canvass/${pr}/rfq/${aInv.id}/decline`, { reason: 'x' },
    r => r.status === 409 && /already quoted/.test(r.data.message), '409')
  await is(D, 'an invitation of another PR is not found', 2, 'POST', `/canvass/${pr}/rfq/99999/decline`, { reason: 'x' }, r => r.status === 404, '404')
  await is(D, 'Procurement marks Beta as declined', 2, 'POST', `/canvass/${pr}/rfq/${bInv.id}/decline`, { reason: 'Called: no stock' },
    r => r.status === 200 && r.data.message === 'Beta Store marked as declined')
  const b2 = await invOf(pr, 'Beta Store')
  t.check(D, 'the canvass shows when, why, and who recorded it', !!b2.declined_at && b2.decline_reason === 'Called: no stock' && b2.declined_by_name === 'User 2', JSON.stringify(b2))
  await is(D, 'marking it twice is refused', 2, 'POST', `/canvass/${pr}/rfq/${bInv.id}/decline`, { reason: 'again' }, r => r.status === 409, '409')

  // ── What a decline stops ─────────────────────────────────────────────
  const X = 'Blocked'
  await is(X, 'Beta\'s link says so', null, 'GET', `/public/quote/${betaTok}`, undefined, r => r.data.declined === true && r.data.open === false)
  await is(X, 'and takes no quotation', null, 'POST', `/public/quote/${betaTok}`, { prices: [{ item: chair, unit_price: 1300 }] },
    r => r.status === 409 && /won't quote/.test(r.data.message), '409')
  await is(X, 'no new link is sent to it', 2, 'POST', `/canvass/${pr}/rfq/${bInv.id}/resend`, undefined, r => r.status === 409 && /declined/.test(r.data.message), '409')

  // ── Undo, then decline again ─────────────────────────────────────────
  const U = 'Undo'
  await is(U, 'the decline is undone', 2, 'POST', `/canvass/${pr}/rfq/${bInv.id}/undecline`, undefined, r => r.status === 200)
  await is(U, 'Beta\'s link takes a quotation again', null, 'GET', `/public/quote/${betaTok}`, undefined, r => r.data.declined === false && r.data.open === true)
  await is(U, 'undoing twice is refused', 2, 'POST', `/canvass/${pr}/rfq/${bInv.id}/undecline`, undefined, r => r.status === 409, '409')
  await must(2, 'POST', `/canvass/${pr}/rfq/${bInv.id}/decline`, { reason: 'Called again: no stock' })

  // ── Closing early ────────────────────────────────────────────────────
  const C = 'Close'
  await is(C, 'with Alpha quoted and Beta declined, the quotations close', 2, 'POST', `/canvass/${pr}/rfq/close`, undefined, r => r.status === 200)
  await is(C, 'Alpha\'s prices are open', 2, 'GET', `/canvass/${pr}`, undefined, r => r.data.quotations.every(q => !q.sealed) && r.data.rfq.open === false)
  await is(C, 'once closed, a decline can\'t change', 2, 'POST', `/canvass/${pr}/rfq/${bInv.id}/undecline`, undefined,
    r => r.status === 409 && /closed/.test(r.data.message), '409')
  await is(C, 'Beta\'s page still says it declined', null, 'GET', `/public/quote/${betaTok}`, undefined, r => r.data.declined === true)
  await is(C, 'Beta\'s profile shows "declined"', 2, 'GET', `/suppliers/${beta}`, undefined,
    r => r.data.rfqs.find(x => x.pr_id === pr)?.result === 'declined', 'declined')

  // ── No reminder or new link to a declined supplier ───────────────────
  const R = 'Emails'
  const pr2 = await approved('Tables')
  await must(2, 'POST', `/canvass/${pr2}/open`, { mode_of_procurement: 'Shopping', deadline: inDays(3), supplier_ids: [alpha, beta] })
  await must(2, 'POST', `/canvass/${pr2}/rfq/${(await invOf(pr2, 'Beta Store')).id}/decline`, { reason: 'Not our line' })
  await H.sql(TEST_DB, 'UPDATE rfq_invitations SET deadline = NOW() + INTERVAL 12 HOUR WHERE purchase_request_id = ?', [pr2])
  await H.sql(TEST_DB, 'UPDATE purchase_requests SET quotations_due = NOW() + INTERVAL 12 HOUR WHERE id = ?', [pr2])
  MAIL.length = 0
  await require(path.join(H.SERVER, 'utils', 'rfqWorkflow.js')).sendRfqReminders()
  t.check(R, 'the day-before reminder goes to Alpha only', MAIL.length === 1 && MAIL[0].to === 'alpha@x.invalid' && /^Reminder/.test(MAIL[0].subject), MAIL.map(m => m.to).join())
  MAIL.length = 0
  await is(R, 'extending the deadline', 2, 'PATCH', `/canvass/${pr2}/rfq/deadline`, { deadline: inDays(5) }, r => r.status === 200)
  t.check(R, '…emails a new link to Alpha only', MAIL.length === 1 && MAIL[0].to === 'alpha@x.invalid', MAIL.map(m => m.to).join())

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, onMail: (m) => { MAIL.push(m) }, run })
