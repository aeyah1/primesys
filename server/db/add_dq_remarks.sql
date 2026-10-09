-- Migration: the TWG's remark on a supplier it found DQ (non-compliant on every item it offered).
--
-- Shown with the award and Re-PR remarks under each supplier in the bids table. Cleared when the
-- supplier's bids change or it is no longer DQ.
--
-- Run AFTER add_re_pr.sql, BEFORE deploying the server that reads it. Safe to re-run.
-- Rollback: ALTER TABLE `canvass_bidders` DROP COLUMN `dq_remarks`;

ALTER TABLE `canvass_bidders` ADD COLUMN IF NOT EXISTS `dq_remarks` VARCHAR(500) NULL AFTER `attachment_id`;
