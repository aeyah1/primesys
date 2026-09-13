const pool   = require('../db/pool')
const notify = require('./notify')
const { CATEGORIES, categoryLabel } = require('./categories')

// TWG review areas
// A PR is reviewed by the TWG members whose review areas include its category
// (twg_assignments, set by an admin in User Management). The routing is worked
// out when needed, never stored on the PR, so moving an area to another member
// moves that area's waiting PRs at once. Admins may review every area.

// SQL condition, over the purchase_requests alias `pr`: the TWG member whose
// id is the parameter reviews this PR's category.
const IN_AREA = 'EXISTS (SELECT 1 FROM twg_assignments ta WHERE ta.user_id = ? AND ta.category = pr.category)'

const byCategoryOrder = (a, b) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b)

async function areasOf(db, userId) {
  const [rows] = await db.execute('SELECT category FROM twg_assignments WHERE user_id = ?', [userId])
  return rows.map(r => r.category).sort(byCategoryOrder)
}

async function reviewsCategory(db, userId, category) {
  const [rows] = await db.execute('SELECT 1 FROM twg_assignments WHERE user_id = ? AND category = ?', [userId, category])
  return rows.length > 0
}

// Replaces a member's review areas (run inside the caller's transaction).
async function setAreas(db, userId, areas, assignedBy) {
  await db.execute('DELETE FROM twg_assignments WHERE user_id = ?', [userId])
  for (const category of [...new Set(areas)]) {
    await db.execute('INSERT INTO twg_assignments (user_id, category, assigned_by) VALUES (?, ?, ?)', [userId, category, assignedBy])
  }
}

// Active TWG members who review a category.
async function areaReviewers(db, category) {
  const [rows] = await db.execute(
    `SELECT u.id, u.name FROM twg_assignments ta JOIN users u ON u.id = ta.user_id
      WHERE ta.category = ? AND u.role = 'twg' AND u.is_active = 1 ORDER BY u.name`,
    [category]
  )
  return rows
}

// Every category with its active reviewers and how many PRs wait for review
// in it, so an admin can see an area nobody covers.
async function coverage(db) {
  const [reviewers] = await db.execute(
    `SELECT ta.category, u.id, u.name FROM twg_assignments ta JOIN users u ON u.id = ta.user_id
      WHERE u.role = 'twg' AND u.is_active = 1 ORDER BY u.name`
  )
  const [waiting] = await db.execute(
    "SELECT category, COUNT(*) AS n FROM purchase_requests WHERE status = 'submitted' AND deleted_at IS NULL GROUP BY category"
  )
  return CATEGORIES.map(category => ({
    category,
    label: categoryLabel(category),
    reviewers: reviewers.filter(r => r.category === category).map(({ id, name }) => ({ id, name })),
    waiting: Number(waiting.find(w => w.category === category)?.n || 0),
  }))
}

// Tells a PR's area reviewers it is waiting for them. When no active member
// reviews that area, the admins are told instead (they can assign a reviewer
// or review it themselves), so a PR never waits unnoticed.
async function notifyAreaReviewers(io, pr, { resubmitted = false, exceptId = null } = {}) {
  const prLabel = pr.title ? `${pr.pr_number} — ${pr.title}` : pr.pr_number
  const area    = categoryLabel(pr.category)
  const reviewers = await areaReviewers(pool, pr.category)
  if (reviewers.length) {
    const message = resubmitted
      ? `PR ${prLabel} (${area}) was revised and is awaiting TWG review again.`
      : `PR ${prLabel} (${area}) is awaiting TWG review.`
    for (const u of reviewers) if (u.id !== exceptId) await notify(io, u.id, message, 'info', pr.id, 'pr')
    return
  }
  const [admins] = await pool.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1")
  for (const a of admins) {
    await notify(io, a.id,
      `PR ${prLabel} is waiting for TWG review, but no active TWG member reviews ${area}. Assign a reviewer in User Management.`,
      'warning', pr.id, 'pr')
  }
}

module.exports = { IN_AREA, areasOf, reviewsCategory, setAreas, coverage, notifyAreaReviewers }
