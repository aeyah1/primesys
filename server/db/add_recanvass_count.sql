-- Migration: how many times the TWG ordered a re-canvass of a request.
--
-- A request the TWG sent back to canvass for new quotations (no offer met the specifications) keeps a
-- "Re-canvassed" marker for good, on its page and in every list, with the count when it happened more than once.
-- Corrections (the TWG's Return to the BAC, the BAC's Take back) don't count.
--
-- Run AFTER add_recanvass_reason.sql, BEFORE deploying the server that reads it. Safe to re-run.
-- Rollback: ALTER TABLE `purchase_requests` DROP COLUMN `recanvass_count`;

ALTER TABLE `purchase_requests` ADD COLUMN IF NOT EXISTS `recanvass_count` TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER `recanvass_reason`;
