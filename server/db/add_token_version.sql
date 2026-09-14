-- Sessions end when a password changes (audit SEC-1).
--
-- Every sign-in token carries the account's token_version. Changing the
-- password, resetting it by email, or an admin setting a new one raises the
-- number, so tokens issued before stop working at once (they used to stay
-- valid for up to 7 days). Existing tokens have no version and count as 0, so
-- nobody is signed out by this migration itself.
--
-- Run BEFORE starting the server code that reads the column.
-- ADD COLUMN IF NOT EXISTS works on MariaDB (XAMPP); safe to re-run.
-- Rollback: ALTER TABLE `users` DROP COLUMN `token_version`; (with the old code)
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `token_version` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `is_approved`;
