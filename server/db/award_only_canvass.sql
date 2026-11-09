-- Migration: quotations are no longer entered; Procurement records only the BAC's award (panel use case, 2026-11-09).
--
-- The TWG now checks the award of an IT or hardware request (status twg_certification, "TWG checking the award")
-- instead of every supplier's quotation, and there is no Re-PR, so "Choosing the supplier" (bac_review) and
-- "Re-PR proposed" (re_pr) are retired. A request left in the old canvass steps (with the TWG checking quotations
-- before any award, waiting for its award, or with a Re-PR proposed) goes back to canvass, where Procurement records
-- its award; the move is logged against the first admin. A request whose award waits for the TWG's check is left alone.
-- No table changes: the quotations, TWG marks and certificates already entered stay on record.
--
-- Run once, AFTER add_face_check.sql and BEFORE deploying the server that needs it. Safe to run again.
-- Both statements pick the same requests; run them in this order.
-- Rollback: none needed; the status log keeps where each request was.

INSERT INTO `pr_status_logs` (`pr_id`, `changed_by`, `from_status`, `to_status`, `note`)
SELECT pr.id, (SELECT MIN(u.id) FROM `users` u WHERE u.role = 'admin'), pr.status, 'bidding',
       'Back in canvass: quotations are no longer entered. Procurement records the BAC''s award.'
  FROM `purchase_requests` pr
 WHERE pr.deleted_at IS NULL
   AND pr.status IN ('twg_certification', 'bac_review', 're_pr')
   AND NOT EXISTS (SELECT 1 FROM `lots` l WHERE l.purchase_request_id = pr.id AND l.status = 'awarded' AND l.certified_at IS NULL);

UPDATE `purchase_requests` pr SET pr.status = 'bidding'
 WHERE pr.deleted_at IS NULL
   AND pr.status IN ('twg_certification', 'bac_review', 're_pr')
   AND NOT EXISTS (SELECT 1 FROM `lots` l WHERE l.purchase_request_id = pr.id AND l.status = 'awarded' AND l.certified_at IS NULL);
