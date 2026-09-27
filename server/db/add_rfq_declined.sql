-- Migration: an invited supplier who won't quote.
--
-- Procurement can record that an invited supplier declined to quote (they
-- said so by phone, email, or in person), with the reason. A declined
-- supplier's link no longer takes a quotation and gets no reminders, and the
-- quotations can close early once every invited supplier has quoted or declined.
--
-- Run AFTER add_supplier_links.sql.
-- Rollback:
--   ALTER TABLE `rfq_invitations` DROP FOREIGN KEY `fk_rfq_declined_by`;
--   ALTER TABLE `rfq_invitations` DROP COLUMN `declined_at`, DROP COLUMN `declined_by`, DROP COLUMN `decline_reason`;

ALTER TABLE `rfq_invitations`
  ADD COLUMN `declined_at`    DATETIME     NULL AFTER `submit_count`,
  ADD COLUMN `declined_by`    INT UNSIGNED NULL AFTER `declined_at`,
  ADD COLUMN `decline_reason` VARCHAR(500) NULL AFTER `declined_by`,
  ADD CONSTRAINT `fk_rfq_declined_by` FOREIGN KEY (`declined_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;
