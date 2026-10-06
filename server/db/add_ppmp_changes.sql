-- Migration: correcting a PPMP after it is uploaded.
--
-- A Fund Administrator may edit the PPMP in effect on screen; the edits are
-- saved as its next version, in effect at once, and the one edited is kept as
-- superseded. edited_from names that version, whose uploaded file stays with it.
--
-- To remove a PPMP in effect, the Fund Administrator asks an admin, with the
-- reason; the admin withdraws it (kept on record) or declines. The removal_*
-- columns hold the request while it waits.
--
-- Run AFTER add_ppmp_quarters.sql (and fill_ppmp_quarters.js). Safe to re-run.

ALTER TABLE `ppmps` ADD COLUMN IF NOT EXISTS `edited_from` INT UNSIGNED NULL AFTER `version_no`;
ALTER TABLE `ppmps` ADD COLUMN IF NOT EXISTS `removal_requested_by` INT UNSIGNED NULL;
ALTER TABLE `ppmps` ADD COLUMN IF NOT EXISTS `removal_requested_at` DATETIME NULL;
ALTER TABLE `ppmps` ADD COLUMN IF NOT EXISTS `removal_reason` VARCHAR(500) NULL;
