-- Migration: each office's sections, so Office / Section is picked from a list (panel review, 2026-10-26).
--
-- The admin lists an office's sections under Organization, one per line. A Fund Administrator then picks the
-- request's Office / Section from the office's code, its name and those sections; requests already filed keep what
-- they print.
--
-- Run once, AFTER remove_bac_role.sql and BEFORE deploying the server that reads it.
-- Rollback:
--   ALTER TABLE `departments` DROP COLUMN `sections`;

ALTER TABLE `departments`
  ADD COLUMN `sections` TEXT NULL AFTER `head_designation`;
