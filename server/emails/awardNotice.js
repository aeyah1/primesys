const esc = require('../utils/escapeHtml')

// Tells a supplier its quotation won, with the Notice of Award attached. It
// names only this supplier's own award, never another supplier's offer.
// entity, contact; supplierName, prNumber, purpose, resolutionNumber, total (formatted)
module.exports = function awardNoticeEmail({ entity, contact, supplierName, prNumber, purpose, resolutionNumber, total }) {
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;">
      <h2 style="color:#1E40AF;font-size:20px;margin:0 0 4px;">${esc(entity)}</h2>
      <p style="color:#6b7280;font-size:13px;margin:0 0 24px;">Notice of Award</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin-bottom:24px;" />
      <p style="font-size:15px;color:#111827;">Dear <strong>${esc(supplierName)}</strong>,</p>
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        We are pleased to inform you that the contract for the items below has been awarded to you.
        The Notice of Award is attached.
      </p>
      <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0;font-size:15px;font-weight:600;color:#1E40AF;">Purchase Request ${esc(prNumber)}</p>
        ${purpose ? `<p style="margin:6px 0 0;font-size:14px;color:#1f2937;">${esc(purpose)}</p>` : ''}
        <p style="margin:6px 0 0;font-size:13px;color:#374151;">BAC Resolution No. <strong>${esc(resolutionNumber)}</strong></p>
        <p style="margin:6px 0 0;font-size:13px;color:#374151;">Contract price: <strong>${esc(total)}</strong></p>
      </div>
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        Please sign the conforme on the Notice of Award and return a copy to the procurement office.
        The purchase order will follow.
      </p>
      <p style="color:#6b7280;font-size:12px;line-height:1.5;">
        Questions? Contact the procurement office${contact ? ` at ${esc(contact)}` : ''}.
        If this email reached you by mistake, please tell the office and delete it.
      </p>
      <p style="color:#9ca3af;font-size:11px;line-height:1.5;margin-top:24px;">
        Privacy: the contact details you give are used only for this procurement, as the Data Privacy Act of 2012 requires.
      </p>
    </div>
  `
}
