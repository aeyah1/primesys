-- Migration: the BAC decides offline; Procurement records its work in PRimeSys (panel's revised use case, 2026-10-26).
--
-- Every BAC account becomes a Procurement account. The suppliers' RFQ files keep their privacy through a flag on the
-- file (pr_attachments.is_rfq) instead of who uploaded them, so the files BAC members attached stay hidden from End
-- Users. The RFQ History open/lock switch is gone, so its settings are removed.
--
-- Run once, AFTER add_spec_check.sql and BEFORE deploying the server that reads it.
-- If TiDB refuses the ENUM change, skip that statement: no account keeps the 'bac' role, so it stays unused.
-- Rollback:
--   ALTER TABLE `users` MODIFY `role` ENUM('admin','procurement','requestor','supply','twg','bac') NOT NULL DEFAULT 'requestor';
--   ALTER TABLE `pr_attachments` DROP COLUMN `is_rfq`;

ALTER TABLE `pr_attachments`
  ADD COLUMN `is_rfq` TINYINT(1) NOT NULL DEFAULT 0 AFTER `size`;

UPDATE `pr_attachments` a JOIN `users` u ON u.id = a.uploaded_by SET a.is_rfq = 1 WHERE u.role = 'bac';
UPDATE `pr_attachments` a JOIN `canvass_bidders` d ON d.attachment_id = a.id SET a.is_rfq = 1;

UPDATE `users` SET `role` = 'procurement' WHERE `role` = 'bac';

ALTER TABLE `users`
  MODIFY `role` ENUM('admin','procurement','requestor','supply','twg') NOT NULL DEFAULT 'requestor';

DELETE FROM `org_settings` WHERE `setting_key` IN ('rfq_history_open', 'rfq_history_until', 'rfq_history_by', 'rfq_history_at');
