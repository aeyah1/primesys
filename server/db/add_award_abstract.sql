-- Migration: awards on an Abstract of sealed Quotations.
--
-- A request whose approved budget is below the resolution threshold (org_settings resolution_threshold,
-- 50,000 by default) is awarded on the Abstract of sealed Quotations alone, with no BAC Resolution.
-- bac_resolutions keeps every award round either way: kind 'resolution' (numbered, as before) or
-- 'abstract' (no number). Earlier awards stay resolutions.
--
-- Run AFTER add_suppliers.sql, BEFORE deploying the server that reads it. Safe to re-run (MariaDB).
-- Rollback (only while no abstract award exists):
--   ALTER TABLE `bac_resolutions` DROP COLUMN `kind`, MODIFY `resolution_number` VARCHAR(30) NOT NULL;
--   DELETE FROM `org_settings` WHERE `setting_key` = 'resolution_threshold';

ALTER TABLE `bac_resolutions` ADD COLUMN IF NOT EXISTS `kind` ENUM('resolution','abstract') NOT NULL DEFAULT 'resolution' AFTER `id`;
ALTER TABLE `bac_resolutions` MODIFY `resolution_number` VARCHAR(30) NULL;
INSERT IGNORE INTO `org_settings` (`setting_key`, `setting_value`) VALUES ('resolution_threshold', '50000');
