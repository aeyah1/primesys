-- Migration: uploaded files expire after a set period once their request is finished (panel review, 2026-10-26).
--
-- A request's files and its deliveries' files are deleted from storage file_retention_days (default 90; 0 keeps them)
-- after the request is completed, cancelled, rejected or deleted (utils/retention.js). The row stays, with removed_at,
-- so the record shows what was attached and when it was removed; the paper originals are kept by the offices.
--
-- Run once, AFTER add_department_sections.sql and BEFORE deploying the server that reads it.
-- Rollback:
--   ALTER TABLE `pr_attachments` DROP COLUMN `removed_at`;
--   ALTER TABLE `delivery_attachments` DROP COLUMN `removed_at`;
--   DELETE FROM `org_settings` WHERE `setting_key` = 'file_retention_days';

ALTER TABLE `pr_attachments`
  ADD COLUMN `removed_at` DATETIME NULL AFTER `uploaded_by`;

ALTER TABLE `delivery_attachments`
  ADD COLUMN `removed_at` DATETIME NULL AFTER `uploaded_by`;

INSERT INTO `org_settings` (`setting_key`, `setting_value`) VALUES ('file_retention_days', '90')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;
