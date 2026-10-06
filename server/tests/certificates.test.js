// The Certificates page: every TWG certificate already issued on the PRs a user may see (C2), newest first, by kind,
// searchable, for the TWG, the BAC, Procurement and admins; never a deleted PR's. Real HTTP against a throwaway database.
const path = require('path')
const H    = require('./harness')

const { db: TEST_DB, base: BASE } = H.configure({ db: 'primesys_certificates_test_tmp', port: 5138 })
const serverReq = (m) => require(require.resolve(m, { paths: [H.SERVER] }))
const config = require(path.join(H.SERVER, 'config.js'))
const jwt    = serverReq('jsonwebtoken')
const ROLE = { 1: 'admin', 2: 'procurement', 3: 'requestor', 4: 'supply', 5: 'twg', 6: 'bac', 7: 'twg' }
const tok  = (id) => jwt.sign({ id }, config.jwt.secret, { expiresIn: '1h' })

function fixtures() {
  const hash = serverReq('bcryptjs').hashSync('Test@1234', 4)
  const U = (id, name) => `(${id}, '${name}', 'u${id}', 'u${id}@certs.invalid', '${hash}', '${ROLE[id]}', 1, 1, 90)`
  const P = (id, title, status, category, deleted = 'NULL') =>
    `(${id}, 'CSO-2026-10-00${id}', '${title}', '${status}', 3, '${category}', 'DIT', 90, 5, ${deleted})`
  return `
    SET FOREIGN_KEY_CHECKS = 0;
    INSERT INTO departments (id, code, name) VALUES (90, 'DIT', 'Industrial Technology');
    INSERT INTO users (id, name, username, email, password_hash, role, is_active, is_verified, department_id) VALUES
      ${U(1, 'Admin One')}, ${U(2, 'Proc One')}, ${U(3, 'Felix')}, ${U(4, 'Supply One')}, ${U(5, 'Twg Hardware')}, ${U(6, 'Bac One')}, ${U(7, 'Twg Furniture')};
    INSERT INTO purchase_requests (id, pr_number, title, status, created_by, category, department, department_id, twg_reviewed_by, deleted_at) VALUES
      ${P(40, 'Projector', 'bac_review', 'hardware')}, ${P(41, 'Office chairs', 'for_po', 'furniture')},
      ${P(42, 'Printer', 'twg_review', 'hardware')}, ${P(43, 'Deleted one', 'twg_review', 'hardware', 'NOW()')};
    INSERT INTO twg_certificates (id, cert_no, pr_id, kind, certified_by, signature, created_at) VALUES
      (1, '2026-10-001', 40, 'review', 5, NULL, '2026-10-01 09:00:00'),
      (2, '2026-10-002', 41, 'review', 7, 'data:image/png;base64,AAAA', '2026-10-02 09:00:00'),
      (3, '2026-10-003', 40, 'bids',   5, 'data:image/png;base64,AAAA', '2026-10-03 09:00:00'),
      (4, '2026-10-004', 42, 'review', 5, NULL, '2026-10-04 09:00:00'),
      (5, '2026-10-005', 43, 'review', 5, NULL, '2026-10-05 09:00:00');
    ${H.twgAreas([5], ['hardware'])}
    ${H.twgAreas([7], ['furniture'])}
    SET FOREIGN_KEY_CHECKS = 1;
  `
}
async function http(who, p) {
  const res = await fetch(BASE + p, { headers: { Authorization: `Bearer ${tok(who)}` } })
  return { status: res.status, data: await res.json().catch(() => null) }
}

async function run() {
  const t = H.suite('CERTIFICATES')
  const is = async (g, label, who, p, ok) => { const r = await http(who, p); t.check(g, label, ok(r), `${r.status} ${JSON.stringify(r.data)}`.slice(0, 400)); return r }
  const ids = (r) => (r.data?.data || []).map(c => c.id).join()

  const W = 'Who sees which'
  await is(W, 'an admin: every certificate, newest first, never a deleted PR\'s', 1, '/bac/certificates', (r) => r.status === 200 && ids(r) === '4,3,2,1')
  await is(W, '…with counts by kind', 1, '/bac/certificates', (r) => r.data.counts.all === 4 && r.data.counts.review === 3 && r.data.counts.bids === 1 && r.data.total === 4)
  await is(W, 'Procurement: every one too', 2, '/bac/certificates', (r) => ids(r) === '4,3,2,1')
  await is(W, 'the BAC: the PRs it sees', 6, '/bac/certificates', (r) => ids(r) === '4,3,2,1')
  await is(W, 'a TWG member: only their review areas (hardware)', 5, '/bac/certificates', (r) => ids(r) === '4,3,1' && r.data.counts.all === 3)
  await is(W, '…and the other member: furniture', 7, '/bac/certificates', (r) => ids(r) === '2')
  await is(W, 'a Fund Administrator: not this page', 3, '/bac/certificates', (r) => r.status === 403)
  await is(W, 'Supply: not this page', 4, '/bac/certificates', (r) => r.status === 403)

  const S = 'What each row says'
  await is(S, 'the certificate, its kind, who issued it, signed or not, and its PR', 1, '/bac/certificates', (r) => {
    const c = r.data.data.find(x => x.id === 2)
    return c.cert_no === '2026-10-002' && c.kind === 'review' && c.certified_by_name === 'Twg Furniture' && c.signed === true
      && c.pr_id === 41 && c.pr_number === 'CSO-2026-10-0041' && c.title === 'Office chairs' && c.department === 'DIT'
      && r.data.data.find(x => x.id === 1).signed === false && !('signature' in c)
  })
  await is(S, 'canvass bids only', 1, '/bac/certificates?kind=bids', (r) => ids(r) === '3' && r.data.total === 1 && r.data.counts.all === 4)
  await is(S, 'requests checked only', 1, '/bac/certificates?kind=review', (r) => ids(r) === '4,2,1' && r.data.total === 3)
  await is(S, 'an unknown kind shows them all', 1, '/bac/certificates?kind=x', (r) => ids(r) === '4,3,2,1')
  await is(S, 'search by Cert. No.', 1, '/bac/certificates?search=10-003', (r) => ids(r) === '3' && r.data.counts.all === 1)
  await is(S, 'search by PR No.', 1, '/bac/certificates?search=0040', (r) => ids(r) === '3,1')
  await is(S, 'search by title', 1, '/bac/certificates?search=chairs', (r) => ids(r) === '2')
  await is(S, 'the TWG\'s search stays in its areas', 5, '/bac/certificates?search=chairs', (r) => ids(r) === '')
  await is(S, 'paged', 1, '/bac/certificates?limit=2&page=2', (r) => ids(r) === '2,1' && r.data.totalPages === 2)
  await is(S, 'each one still prints', 5, '/bac/40/certificates/3/pdf', (r) => r.status === 200)
  return t.summary()
}

H.main({ db: TEST_DB, base: BASE, fixtures, run })
