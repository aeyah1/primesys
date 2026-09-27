-- Migration: when a PR's quotations are due.
--
-- "Open for quotations" starts a canvass in one step: the mode, the schedule
-- (when quotations close), and, optionally, the RFQs emailed to suppliers. A
-- canvass on paper alone has no emailed RFQ to carry its deadline, so the
-- schedule is kept on the PR. Emailed RFQs use the same time as their deadline.
--
-- Run AFTER add_supplier_rfq.sql.
-- Rollback: ALTER TABLE `purchase_requests` DROP COLUMN `quotations_due`;

ALTER TABLE `purchase_requests`
  ADD COLUMN `quotations_due` DATETIME NULL AFTER `mode_of_procurement`;
