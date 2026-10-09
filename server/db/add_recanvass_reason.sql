-- Migration: why the TWG ordered a re-canvass.
--
-- The TWG decides the canvass result: Certify, Re-canvass (no offer for a lot meets the specifications, so the
-- request goes back to canvass for new quotations) or Return to the BAC. The re-canvass reason shows to the BAC,
-- Procurement and the End User while the request is in canvass, and is cleared when it leaves the canvass.
--
-- Run AFTER add_saved_signature.sql, BEFORE deploying the server that reads it. Safe to re-run.
-- Rollback: ALTER TABLE `purchase_requests` DROP COLUMN `recanvass_reason`;

ALTER TABLE `purchase_requests` ADD COLUMN IF NOT EXISTS `recanvass_reason` TEXT NULL AFTER `certification_return_reason`;
