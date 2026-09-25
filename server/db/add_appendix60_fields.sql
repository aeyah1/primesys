-- Migration: the fields the official Purchase Request form (Appendix 60) needs.
--
-- The printed form carries four signatories and an entity name that the system
-- had nowhere to store:
--   Requested by  - the person who filed it, and their designation
--   Approved by   - the Campus Director
--   Allotment/Appropriation Available - the Budget Officer
--   Included in the APP               - the BAC Secretariat
-- The last three are campus-wide, so they live in org_settings. The
-- requestor's designation is copied onto each PR when it is filed, so a later
-- change to their job title does not rewrite PRs already on record.
--
-- It also adds the form's Stock/Property No. column (optional, assigned by the
-- Supply Office) and the PR-number prefix, which the form shows as "CSO 2026-".
--
-- Run BEFORE starting the server code that reads these fields.
-- Rollback: the three DROP COLUMN statements at the bottom of this file.

ALTER TABLE `users`
  ADD COLUMN `designation` VARCHAR(150) NULL AFTER `name`;

ALTER TABLE `purchase_requests`
  ADD COLUMN `requested_by_designation` VARCHAR(150) NULL AFTER `created_by`;

ALTER TABLE `pr_items`
  ADD COLUMN `stock_property_no` VARCHAR(50) NULL AFTER `pr_id`;

-- Campus-wide values for the form. Left NULL so an admin fills them in under
-- Settings > Organization; the form prints a blank signature line until then.
-- pr_number_prefix defaults to CSO (Cantilan Supply Office), the prefix on the
-- campus's own form.
INSERT INTO `org_settings` (`setting_key`, `setting_value`) VALUES
  ('entity_name',                  'NEMSU - Cantilan Campus'),
  ('pr_number_prefix',             'CSO'),
  ('approved_by_name',             NULL),
  ('approved_by_designation',      'Campus Director'),
  ('allotment_by_name',            NULL),
  ('allotment_by_designation',     'AO IV/Budget Officer II'),
  ('app_certified_by_name',        NULL),
  ('app_certified_by_designation', 'BAC Secretariat')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;   -- keep values already set

-- Rollback
-- ALTER TABLE `users`             DROP COLUMN `designation`;
-- ALTER TABLE `purchase_requests` DROP COLUMN `requested_by_designation`;
-- ALTER TABLE `pr_items`          DROP COLUMN `stock_property_no`;
-- DELETE FROM `org_settings` WHERE `setting_key` IN
--   ('entity_name','pr_number_prefix','approved_by_name','approved_by_designation',
--    'allotment_by_name','allotment_by_designation','app_certified_by_name','app_certified_by_designation');
