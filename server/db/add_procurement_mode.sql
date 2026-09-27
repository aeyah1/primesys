-- Migration: record how each request is procured, and how many quotations the
-- campus expects before an award.
--
-- 1. MODE OF PROCUREMENT was nowhere in the system. Every purchase was treated
--    as though it were canvassed, which is what the campus does for most of
--    them (Small Value Procurement or Shopping) but not for all. The mode
--    decides which path a purchase must follow and is what an auditor looks
--    for, so it belongs on the record. Procurement sets it; it is not asked of
--    the person filing the request.
--
--    Kept as text rather than an ENUM because RA 12009 (2024) reorganised the
--    alternative modes and the GPPB amends them by resolution: the accepted
--    list lives in server/utils/procurementModes.js so it can be corrected
--    without a migration.
--
-- 2. MINIMUM QUOTATIONS. Canvassing exists to compare at least three suppliers,
--    but the system would award from one without a word. The count is a setting
--    so the campus can match its own rule, and an award below it now needs a
--    written reason rather than being silently allowed.
--
-- Run AFTER add_nemsu_forms.sql.
-- Rollback: the statements at the bottom of this file.

ALTER TABLE `purchase_requests`
  ADD COLUMN `mode_of_procurement` VARCHAR(60) NULL AFTER `fund_source`;

-- Awards made before this existed carry no reason; the column is only filled
-- when an award is made with fewer quotations than the campus expects.
ALTER TABLE `lots`
  ADD COLUMN `few_quotations_reason` VARCHAR(500) NULL AFTER `notes`;

INSERT INTO `org_settings` (`setting_key`, `setting_value`) VALUES
  ('minimum_quotations', '3')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;

-- Rollback
-- ALTER TABLE `purchase_requests` DROP COLUMN `mode_of_procurement`;
-- ALTER TABLE `lots`              DROP COLUMN `few_quotations_reason`;
-- DELETE FROM `org_settings` WHERE `setting_key` = 'minimum_quotations';
