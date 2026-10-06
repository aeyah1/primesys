-- Migration: admin-approved sign-up for Fund Administrators.
--
-- Sign-up no longer sends an email link: a new account waits until an admin
-- approves it (users.is_verified = 1). The emailed link's columns are dropped.
-- Accounts that never clicked their old link stay unapproved, so they now show
-- under "Waiting for approval" in User Management.
--
-- Run AFTER add_rfq_declined.sql, with the server code that no longer reads the columns.
-- Rollback:
--   ALTER TABLE `users` ADD COLUMN `verify_token` VARCHAR(64) NULL AFTER `token_version`;
--   ALTER TABLE `users` ADD COLUMN `verify_expires` DATETIME NULL AFTER `verify_token`;

-- One change per statement, for TiDB.
ALTER TABLE `users` DROP COLUMN `verify_token`;
ALTER TABLE `users` DROP COLUMN `verify_expires`;
