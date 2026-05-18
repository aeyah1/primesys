// Escapes a value for safe interpolation into HTML (email bodies, etc.).
// Always use this for any user-controlled string that ends up inside `<...>${...}<...>`.
const MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
}

module.exports = function escapeHtml(value) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[&<>"'/]/g, (ch) => MAP[ch])
}
