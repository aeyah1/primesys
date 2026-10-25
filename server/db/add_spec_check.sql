-- Migration: the TWG's check of a specification the End User typed for an ICT item (Hardware & Equipment).
--
-- ICT specifications are never taken from the PPMP: the End User types them on the request, and the TWG marks
-- each one checked before it can approve the request. Cleared when the End User changes that specification.
--
-- Run once, AFTER add_audit_logs.sql and BEFORE deploying the server that reads it.
-- Rollback:
--   ALTER TABLE `pr_items` DROP FOREIGN KEY `fk_pr_items_spec_checked_by`;
--   ALTER TABLE `pr_items` DROP COLUMN `spec_checked_by`, DROP COLUMN `spec_checked_at`;

ALTER TABLE `pr_items`
  ADD COLUMN `spec_checked_at` DATETIME NULL AFTER `notes`,
  ADD COLUMN `spec_checked_by` INT UNSIGNED NULL AFTER `spec_checked_at`,
  ADD KEY `idx_pr_items_spec_checked_by` (`spec_checked_by`),
  ADD CONSTRAINT `fk_pr_items_spec_checked_by` FOREIGN KEY (`spec_checked_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;
