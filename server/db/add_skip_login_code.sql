-- Migration: accounts that sign in without the emailed code.
--
-- The admin may exempt an account from the new-device sign-in code (utils/loginDevices.js), for demonstration or
-- shared accounts whose email can't receive it: it then signs in with its password alone, as administrators do.
--
-- Run AFTER add_user_devices.sql, BEFORE deploying the server that reads it. Safe to re-run (MariaDB, TiDB).
-- Rollback: ALTER TABLE `users` DROP COLUMN `skip_login_code`;

ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `skip_login_code` TINYINT(1) NOT NULL DEFAULT 0 AFTER `session_key`;
