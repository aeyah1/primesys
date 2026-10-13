-- Migration: one session per account.
--
-- users.session_key is the key of the account's latest sign-in. Every token carries the key it was signed in with, so
-- a new sign-in (in another tab or on another device) ends the older session, and signing out ends it on the server.
-- Tokens issued before this column existed carry no key and keep working until the account next signs in.
--
-- Run AFTER add_award_abstract.sql, BEFORE deploying the server that reads it. Safe to re-run (MariaDB, TiDB).
-- Rollback: ALTER TABLE `users` DROP COLUMN `session_key`;

ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `session_key` CHAR(32) NULL AFTER `token_version`;
