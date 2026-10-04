// Purchase requests drawn from the office's verified Final PPMP: items come from
// its lines, a request can't be submitted for more than a line has left, other
// offices' and unverified plans can't be used, and over-price or unscheduled
// items are warned about without blocking. Real HTTP against a throwaway database.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_ppmp_use_test_tmp', port: 5130 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')

// 3 = ICT's Fund Administrator, 4 = DCS's, 7 = HR's (no PPMP yet)
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'requestor', 5: 'twg', 7: 'requestor' }
const OFFICE = { 3: 1, 4: 2, 7: 3 }
const tok  = (id) => jwt.sign({ id, tv: 0 }, config.jwt.secret, { expiresIn: '1h' })
const YEAR = new Date().getFullYear()

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id) => `(${id}, 'User ${id}', 'u${id}', 'u${id}@use.invalid', '${hash}', '${ROLE[id]}', 1, 1, ${OFFICE[id] ?? 'NULL'})`
  const P = (id, dept, year, version, kind, status, fund) =>
    `(${id}, ${dept}, ${year}, ${version}, '${kind}', '${fund}', '${status}')`
  const L = (id, ppmp, description, unit, quantity, cost, months) =>
    `(${id}, ${ppmp}, '${description}', '${unit}', ${quantity}, ${cost}, '${months}', ${id})`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO departments (id, code, name) VALUES (1, 'ICT', 'ICT Office'), (2, 'DCS', 'Department of Computer Studies'), (3, 'HR', 'Human Resources Office');
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, department_id) VALUES ${Object.keys(ROLE).map(U).join(', ')};
    INSERT INTO quarters (id, label, year, start_date, end_date, is_active) VALUES (1, 'Q1', ${YEAR}, '${YEAR}-01-01', '${YEAR}-12-31', 1);
    INSERT INTO org_settings (setting_key, setting_value) VALUES ('fund_code_stf', 'STF-01'), ('fund_code_gaa', 'GAA-01');
    ${H.twgAreas([5])}
    INSERT INTO ppmps (id, department_id, fiscal_year, version_no, kind, fund_source, status) VALUES
      ${P(10, 1, YEAR, 1, 'final', 'approved', 'GAA')}, ${P(11, 1, YEAR, 2, 'final', 'submitted', 'GAA')},
      ${P(12, 1, YEAR + 1, 1, 'final', 'approved', 'GAA')}, ${P(13, 1, YEAR + 2, 1, 'indicative', 'approved', 'GAA')},
      ${P(20, 2, YEAR, 1, 'final', 'approved', 'STF')};
    INSERT INTO ppmp_items (id, ppmp_id, description, unit, quantity, unit_cost, months, sort_order) VALUES
      ${L(1001, 10, 'Bond paper, A4, 80gsm', 'ream', 10, 250, '1,6')}, ${L(1002, 10, 'Toner cartridge, black', 'pc', 2, 3500, '1,2,3,4,5,6,7,8,9,10,11,12')},
      ${L(1101, 11, 'Bond paper, A4, 80gsm', 'ream', 40, 250, '1,6')},
      ${L(1201, 12, 'Stapler, heavy duty', 'pc', 3, 900, '2')}, ${L(1301, 13, 'Projector screen', 'pc', 1, 8000, '5')},
      ${L(2001, 20, 'Bond paper, A4, 80gsm', 'ream', 5, 250, '3')};
    SET FOREIGN_KEY_CHECKS = 1;
  `
}

async function http(who, method, p, body) {
  const headers = { Authorization: `Bearer ${tok(who)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, data: type.includes('json') ? await res.json() : null }
}
const show = (r) => `${r.status} ${JSON.stringify(r.data)}`.slice(0, 300)
const line = (plans, id) => plans.flatMap(p => p.lines).find(l => l.id === id)

async function run() {
  const t = H.suite('PPMP USE')
  const is = async (g, label, who, m, p, body, ok, want) => {
    const r = await http(who, m, p, body)
    t.check(g, label, ok(r), `${show(r)}${want ? ` (want ${want})` : ''}`)
    return r
  }
  const file = async (who, items, extra = {}) => (await http(who, 'POST', '/pr', { title: 'Office supplies', items, ...extra })).data.id
  const submit = (who, id) => http(who, 'PATCH', `/pr/${id}/status`, { status: 'submitted' })

  // ── What a request may draw on ──────────────────────────────────────
  const G = 'Lines'
  await is(G, 'a Fund Administrator sees their office\'s verified Final PPMPs', 3, 'GET', '/ppmp/lines', undefined,
    r => r.status === 200 && r.data.map(p => p.id).join() === '10,12', 'ICT 10 and 12 (not the pending amendment, not the indicative)')
  await is(G, '…with what is left of each line', 3, 'GET', '/ppmp/lines', undefined,
    r => line(r.data, 1001)?.remaining === 10 && line(r.data, 1002)?.remaining === 2, '10 and 2')
  await is(G, 'asking for another office still gives their own', 3, 'GET', '/ppmp/lines?department_id=2', undefined,
    r => r.data.map(p => p.id).join() === '10,12', 'ICT')
  await is(G, 'staff name the office', 2, 'GET', '/ppmp/lines?department_id=2', undefined, r => r.data.map(p => p.id).join() === '20', 'DCS')
  await is(G, 'an office with no verified PPMP has none', 7, 'GET', '/ppmp/lines', undefined, r => r.status === 200 && r.data.length === 0, '[]')

  // ── Picking items ───────────────────────────────────────────────────
  const K = 'Picking'
  const picked = await is(K, 'an item picked from the PPMP saves', 3, 'POST', '/pr',
    { title: 'Paper', items: [{ ppmp_item_id: 1001, item_name: 'Something else', unit: 'box', quantity: 2, estimated_cost: 250 }] }, r => r.status === 201)
  await is(K, '…named and measured as the PPMP line, not as typed', 3, 'GET', `/pr/${picked.data.id}/items`, undefined,
    r => r.data[0].ppmp_item_id === 1001 && r.data[0].item_name === 'Bond paper, A4, 80gsm' && r.data[0].unit === 'ream', 'the line')
  await is(K, 'another office\'s line is refused', 3, 'POST', '/pr', { title: 'x', items: [{ ppmp_item_id: 2001, quantity: 1 }] },
    r => r.status === 400 && /another office's PPMP/.test(r.data.message), '400')
  await is(K, 'a line of an unverified amendment is refused', 3, 'POST', '/pr', { title: 'x', items: [{ ppmp_item_id: 1101, quantity: 1 }] },
    r => r.status === 400 && /verified Final PPMP/.test(r.data.message), '400')
  await is(K, 'a line of an Indicative PPMP is refused', 3, 'POST', '/pr', { title: 'x', items: [{ ppmp_item_id: 1301, quantity: 1 }] },
    r => r.status === 400, '400')
  await is(K, 'one request, one year\'s PPMP', 3, 'POST', '/pr', { title: 'x', items: [{ ppmp_item_id: 1001, quantity: 1 }, { ppmp_item_id: 1201, quantity: 1 }] },
    r => r.status === 400 && new RegExp(`${YEAR} and ${YEAR + 1}`).test(r.data.message), '400')
  await is(K, '…also when adding to a draft', 3, 'POST', `/pr/${picked.data.id}/items`, { ppmp_item_id: 1201, quantity: 1 },
    r => r.status === 400, '400')
  const added = await is(K, 'adding a line to a draft', 3, 'POST', `/pr/${picked.data.id}/items`, { ppmp_item_id: 1002, quantity: 1, estimated_cost: 3500 },
    r => r.status === 201 && r.data.item_name === 'Toner cartridge, black' && r.data.unit === 'pc')
  await is(K, 'an item from the PPMP keeps its name when edited', 3, 'PATCH', `/pr/${picked.data.id}/items/${added.data.id}`, { item_name: 'Toner, any', unit: 'box', quantity: 2 },
    r => r.status === 200)
  await is(K, '…while its quantity changes', 3, 'GET', `/pr/${picked.data.id}/items`, undefined,
    r => { const i = r.data.find(x => x.id === added.data.id); return i.item_name === 'Toner cartridge, black' && i.unit === 'pc' && Number(i.quantity) === 2 }, 'name kept, qty 2')
  const elsewhere = await file(3, [], { department_id: 2 })
  await is(K, 'a Fund Administrator\'s request is for their own office', 3, 'GET', `/pr/${elsewhere}`, undefined,
    r => r.data.department_id === 1, 'ICT')

  // ── Submitting ──────────────────────────────────────────────────────
  const S = 'Submitting'
  const typed = await file(3, [{ item_name: 'Stapler, small', quantity: 1, estimated_cost: 100 }])
  await is(S, 'an item not in the PPMP blocks it', 3, 'PATCH', `/pr/${typed}/status`, { status: 'submitted' },
    r => r.status === 409 && /"Stapler, small" is not in the ICT PPMP for \d+/.test(r.data.message), '409')
  const exact = await file(3, [{ item_name: 'toner  cartridge, BLACK', quantity: 1, estimated_cost: 3500 }])
  await is(S, 'an item typed exactly as a PPMP line is taken as that line', 3, 'PATCH', `/pr/${exact}/status`, { status: 'submitted' }, r => r.status === 200)
  await is(S, '…and tied to it', 3, 'GET', `/pr/${exact}/items`, undefined, r => r.data[0].ppmp_item_id === 1002, '1002')
  await is(S, 'the request is funded from the PPMP\'s source', 3, 'GET', `/pr/${exact}`, undefined,
    r => r.data.fund_source === 'GAA' && r.data.fund_cluster === 'GAA-01', 'GAA, GAA-01')

  const a = await file(3, [{ ppmp_item_id: 1001, quantity: 6, estimated_cost: 250 }])
  await is(S, 'a request within the plan goes to the TWG', 3, 'PATCH', `/pr/${a}/status`, { status: 'submitted' }, r => r.status === 200)
  await is(S, '…and holds its quantity', 3, 'GET', '/ppmp/lines', undefined, r => line(r.data, 1001).remaining === 4, '4 left')
  const b = await file(3, [{ ppmp_item_id: 1001, quantity: 3, estimated_cost: 250 }, { ppmp_item_id: 1001, quantity: 2, estimated_cost: 250, group_label: 'Day 2' }])
  await is(S, 'more than is left is blocked, counting every item of the line', 3, 'PATCH', `/pr/${b}/status`, { status: 'submitted' },
    r => r.status === 409 && /Only 4 ream of "Bond paper, A4, 80gsm" is left in the PPMP \(planned 10, other requests hold 6\)/.test(r.data.message), '409')
  await is(S, '…the TWG sees nothing', 3, 'GET', `/pr/${b}`, undefined, r => r.data.status === 'draft')
  const bItems = (await http(3, 'GET', `/pr/${b}/items`)).data
  await http(3, 'PATCH', `/pr/${b}/items/${bItems[1].id}`, { quantity: 1 })
  await is(S, 'lowered to what is left, it goes', 3, 'PATCH', `/pr/${b}/status`, { status: 'submitted' }, r => r.status === 200)
  await is(S, 'nothing is left of the line now', 3, 'GET', '/ppmp/lines', undefined, r => line(r.data, 1001).remaining === 0, '0')
  const c = await file(3, [{ ppmp_item_id: 1001, quantity: 1, estimated_cost: 250 }])
  await is(S, '…so the next request is blocked', 3, 'PATCH', `/pr/${c}/status`, { status: 'submitted' },
    r => r.status === 409 && /Nothing is left of "Bond paper, A4, 80gsm"/.test(r.data.message), '409')
  await is(S, 'withdrawing a request gives its quantity back', 3, 'PATCH', `/pr/${b}/status`, { status: 'draft' }, r => r.status === 200)
  await is(S, '…the next request goes', 3, 'PATCH', `/pr/${c}/status`, { status: 'submitted' }, r => r.status === 200)
  await is(S, 'a cancelled request gives its back too', 1, 'PATCH', `/pr/${a}/status`, { status: 'cancelled' }, r => r.status === 200)
  await is(S, '…6 more left', 3, 'GET', '/ppmp/lines', undefined, r => line(r.data, 1001).remaining === 9, '9 (10 less 1 held)')
  await is(S, 'a request being edited doesn\'t count against itself', 3, 'GET', `/ppmp/lines?pr_id=${c}`, undefined,
    r => line(r.data, 1001).remaining === 10, '10')
  await is(S, 'another office\'s requests don\'t touch this one\'s PPMP', 4, 'GET', '/ppmp/lines', undefined,
    r => line(r.data, 2001).remaining === 5, '5')

  const hr = await file(7, [{ item_name: 'Bond paper, A4, 80gsm', quantity: 1 }])
  await is(S, 'an office with no verified PPMP can\'t submit', 7, 'PATCH', `/pr/${hr}/status`, { status: 'submitted' },
    r => r.status === 409 && /HR has no verified Final PPMP yet/.test(r.data.message), '409')
  const nowhere = await file(2, [{ item_name: 'Bond paper, A4, 80gsm', quantity: 1 }])
  await is(S, 'a request for no office can\'t submit', 2, 'PATCH', `/pr/${nowhere}/status`, { status: 'submitted' },
    r => r.status === 409 && /Pick the office this request is for/.test(r.data.message), '409')
  const forDcs = await file(2, [{ ppmp_item_id: 2001, quantity: 2, estimated_cost: 250 }], { department_id: 2 })
  await is(S, 'staff file for an office from that office\'s PPMP', 2, 'PATCH', `/pr/${forDcs}/status`, { status: 'submitted' }, r => r.status === 200)
  await is(S, '…which it uses up', 4, 'GET', '/ppmp/lines', undefined, r => line(r.data, 2001).remaining === 3, '3')
  const racers = [await file(2, [{ ppmp_item_id: 2001, quantity: 2 }], { department_id: 2 }), await file(2, [{ ppmp_item_id: 2001, quantity: 2 }], { department_id: 2 })]
  const raced = await Promise.all(racers.map(id => submit(2, id)))
  t.check(S, 'two requests submitted at once can\'t both take the last 3', raced.map(r => r.status).sort().join() === '200,409', raced.map(show).join(' | '))
  await is(S, '…so 1 is left', 4, 'GET', '/ppmp/lines', undefined, r => line(r.data, 2001).remaining === 1, '1')
  const waiting = await file(2, [{ ppmp_item_id: 2001, quantity: 1 }], { department_id: 2 })
  const both = await Promise.all([submit(2, waiting),
    http(2, 'POST', '/pr', { title: 'x', department_id: 2, status: 'submitted', items: [{ ppmp_item_id: 2001, quantity: 1 }] })])
  t.check(S, '…nor can filing-and-submitting race a submission for the last one', both.map(r => r.status).sort().join() === '200,409' || both.map(r => r.status).sort().join() === '201,409',
    both.map(show).join(' | '))

  // ── Warnings ────────────────────────────────────────────────────────
  const W = 'Warnings'
  const pricey = await file(3, [{ ppmp_item_id: 1002, quantity: 1, estimated_cost: 4200 }], { date_needed: `${YEAR}-03-15` })
  await is(W, 'a price above the PPMP is warned about', 3, 'GET', `/pr/${pricey}/ppmp`, undefined,
    r => r.status === 200 && r.data.items[0].warnings.some(w => /₱4,200\.00 each is above the PPMP's ₱3,500\.00/.test(w)), 'warning')
  await is(W, '…without blocking it', 3, 'PATCH', `/pr/${pricey}/status`, { status: 'submitted' }, r => r.status === 200)
  const early = await file(3, [{ ppmp_item_id: 1001, quantity: 1, estimated_cost: 250 }], { date_needed: `${YEAR}-03-15` })
  await is(W, 'a month the PPMP doesn\'t schedule is warned about', 3, 'GET', `/pr/${early}/ppmp`, undefined,
    r => r.data.items[0].warnings.some(w => /doesn't schedule it for March \(planned: Jan, Jun\)/.test(w)), 'warning')
  await is(W, '…and the line it uses is shown', 3, 'GET', `/pr/${early}/ppmp`, undefined,
    r => r.data.plan.id === 10 && r.data.items[0].line.id === 1001 && r.data.items[0].line.unit_cost === 250 && r.data.problems.length === 0, 'line 1001')
  await is(W, 'Procurement sees it too', 2, 'GET', `/pr/${pricey}/ppmp`, undefined, r => r.status === 200 && r.data.items[0].line.id === 1002, '200')
  await is(W, 'and the TWG', 5, 'GET', `/pr/${pricey}/ppmp`, undefined, r => r.status === 200, '200')
  await is(W, 'another office\'s Fund Administrator does not', 4, 'GET', `/pr/${pricey}/ppmp`, undefined, r => r.status === 404, '404')

  // ── An amended PPMP carries over what was used ──────────────────────
  const A = 'Amended'
  await H.sql(TEST_DB, `UPDATE ppmps SET status = 'superseded' WHERE id = 10`)
  await H.sql(TEST_DB, `UPDATE ppmps SET status = 'approved' WHERE id = 11`)
  await is(A, 'the verified amendment replaces the old version', 3, 'GET', '/ppmp/lines', undefined, r => r.data.map(p => p.id).join() === '11,12', '11, 12')
  await is(A, '…and its line starts from what requests already hold', 3, 'GET', '/ppmp/lines', undefined,
    r => line(r.data, 1101).remaining === 40 - 1, '39')
  await is(A, 'a draft picked from the old version still submits', 3, 'PATCH', `/pr/${early}/status`, { status: 'submitted' }, r => r.status === 200)
  await is(A, 'a line dropped by the amendment blocks a draft that used it', 3, 'PATCH', `/pr/${picked.data.id}/status`, { status: 'submitted' },
    r => r.status === 409 && /"Toner cartridge, black" is no longer in the ICT PPMP/.test(r.data.message), '409')

  // ── What the PPMP page shows of its use ─────────────────────────────
  const U = 'Usage'
  const item = (r, description) => r.data.items.find(i => i.description === description)
  await is(U, 'each line shows what requests hold and what is left', 3, 'GET', '/ppmp/11', undefined,
    r => item(r, 'Bond paper, A4, 80gsm').requested === 2 && item(r, 'Bond paper, A4, 80gsm').left === 38, '2 requested, 38 left')
  await is(U, '…and which requests hold it', 3, 'GET', '/ppmp/11', undefined,
    r => item(r, 'Bond paper, A4, 80gsm').requests.map(q => `${q.id}:${q.quantity}`).join() === `${c}:1,${early}:1`, `${c} and ${early}`)
  await is(U, '…with the amount they request, for this version\'s lines only', 3, 'GET', '/ppmp/11', undefined, r => r.data.requested_amount === 500, '500')
  await is(U, 'the superseded version shows the same holds against its own plan', 2, 'GET', '/ppmp/10', undefined,
    r => item(r, 'Bond paper, A4, 80gsm').left === 8 && item(r, 'Toner cartridge, black').requested === 2 && item(r, 'Toner cartridge, black').left === 0
      && r.data.requested_amount === 8200, '8 and 0 left, 8200')

  // ── Which offices can file requests ─────────────────────────────────
  const C = 'Coverage'
  const office = (r, code) => r.data.offices.find(o => o.code === code)
  await is(C, 'each office\'s PPMP standing for this year', 2, 'GET', '/ppmp/coverage', undefined,
    r => r.status === 200 && r.data.year === YEAR && office(r, 'ICT').state === 'verified' && office(r, 'ICT').verified.id === 11
      && office(r, 'DCS').state === 'verified' && office(r, 'HR').state === 'none' && office(r, 'HR').fund_admin === 'User 7', 'ICT and DCS verified, HR none')
  await is(C, 'an Indicative PPMP alone does not count', 2, 'GET', `/ppmp/coverage?year=${YEAR + 2}`, undefined,
    r => office(r, 'ICT').state === 'indicative' && office(r, 'DCS').state === 'none', 'indicative')
  await H.sql(TEST_DB, `INSERT INTO ppmps (id, department_id, fiscal_year, version_no, kind, fund_source, status) VALUES (30, 3, ${YEAR}, 1, 'final', 'STF', 'submitted')`)
  await is(C, 'an uploaded one waits for verification', 1, 'GET', '/ppmp/coverage', undefined, r => office(r, 'HR').state === 'waiting' && office(r, 'HR').waiting.id === 30, 'waiting')
  await H.sql(TEST_DB, `UPDATE ppmps SET status = 'draft', return_reason = 'Unsigned' WHERE id = 30`)
  await is(C, 'a returned one says why', 2, 'GET', '/ppmp/coverage', undefined,
    r => office(r, 'HR').state === 'returned' && office(r, 'HR').returned.return_reason === 'Unsigned', 'returned')
  await is(C, 'a Fund Administrator has no coverage view', 3, 'GET', '/ppmp/coverage', undefined, r => r.status === 403, '403')

  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
