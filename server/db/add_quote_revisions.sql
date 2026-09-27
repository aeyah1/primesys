-- Migration: a cap on how often a supplier can send its emailed quotation.
--
-- The quote page counts each submission on the invitation, so a supplier can
-- submit and then change it a few times before the deadline, not endlessly.
--
-- Run AFTER add_quotation_schedule.sql.
-- Rollback: ALTER TABLE `rfq_invitations` DROP COLUMN `submit_count`;

ALTER TABLE `rfq_invitations`
  ADD COLUMN `submit_count` TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER `submitted_at`;

UPDATE `rfq_invitations` SET `submit_count` = 1 WHERE `submitted_at` IS NOT NULL;
