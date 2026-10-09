-- Migration: Re-PR, the TWG sending a request back to its End User through the BAC.
--
-- When the TWG finds every supplier's offer non-compliant (every supplier DQ), it may propose a Re-PR with a
-- reason about the specifications (re_pr_type, re_pr_reason). The request waits for the BAC (status re_pr),
-- which sends it to the End User with an optional note (re_pr_note; revision_requested) or returns it to the
-- TWG. Each Re-PR sent to the End User counts (re_pr_count, never cleared), and the request keeps a Re-PR marker.
-- The new status is appended to the list, as TiDB only appends ENUM members.
--
-- Run AFTER add_recanvass_count.sql, BEFORE deploying the server that reads it. Safe to re-run.
-- Rollback (no request may be in re_pr):
--   ALTER TABLE `purchase_requests` DROP COLUMN `re_pr_count`, DROP COLUMN `re_pr_note`, DROP COLUMN `re_pr_reason`, DROP COLUMN `re_pr_type`;
--   ALTER TABLE `purchase_requests` MODIFY `status` ENUM('draft','submitted','twg_review','revision_requested','rejected','bidding','bac_review','twg_certification','for_po','completed','cancelled') NOT NULL DEFAULT 'draft';

ALTER TABLE `purchase_requests` MODIFY `status` ENUM('draft','submitted','twg_review','revision_requested','rejected','bidding','bac_review','twg_certification','for_po','completed','cancelled','re_pr') NOT NULL DEFAULT 'draft';
ALTER TABLE `purchase_requests` ADD COLUMN IF NOT EXISTS `re_pr_type` VARCHAR(30) NULL AFTER `recanvass_count`;
ALTER TABLE `purchase_requests` ADD COLUMN IF NOT EXISTS `re_pr_reason` TEXT NULL AFTER `re_pr_type`;
ALTER TABLE `purchase_requests` ADD COLUMN IF NOT EXISTS `re_pr_note` TEXT NULL AFTER `re_pr_reason`;
ALTER TABLE `purchase_requests` ADD COLUMN IF NOT EXISTS `re_pr_count` TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER `re_pr_note`;
