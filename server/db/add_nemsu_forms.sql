-- Migration: the rest of what the campus's own procurement forms need.
--
-- Three things the system had wrong or missing, all taken from the campus's
-- filled forms and its "PAKI COMPLETE ALL NEEDED INFORMATION" instruction sheet:
--
-- 1. SOURCE OF FUND is chosen per request, not fixed for the campus. There are
--    three, each with its own code, and the sheet says to change the code with
--    the source. The chosen source's code is frozen onto the PR as its
--    fund_cluster when it is filed.
--       STF  05-206441        GAA  01-101101        IGP  05-206441-IGP
--
-- 2. WHO APPROVES depends on the amount: at or below the threshold it is the
--    Campus Director, above it the University President. The system printed the
--    Campus Director on every request.
--
-- 3. The REQUEST FOR QUOTATION is signed by the BAC Vice Chairman and the
--    Canvasser, neither of whom existed in the system, and its letterhead
--    carries the university's full name, address, telefax and website.
--
-- Run AFTER add_departments.sql.
-- Rollback: the statements at the bottom of this file.

-- Which of the three funds a request is drawn on.
ALTER TABLE `purchase_requests`
  ADD COLUMN `fund_source` ENUM('STF','GAA','IGP') NOT NULL DEFAULT 'STF' AFTER `fund_cluster`;

-- Existing requests keep whatever code they were filed with; STF is the default
-- and the only one the campus had configured, so nothing needs rewriting.

INSERT INTO `org_settings` (`setting_key`, `setting_value`) VALUES
  -- The letterhead on the Request for Quotation.
  ('entity_full_name',              'NORTH EASTERN MINDANAO STATE UNIVERSITY'),
  ('entity_campus',                 'Cantilan Campus'),
  ('entity_address',                'Cantilan Surigao del Sur'),
  ('entity_telefax',                '086-212-5132'),
  ('entity_website',                'www.nemsu.edu.ph'),
  -- Source of fund: the code printed for each choice.
  ('fund_code_stf',                 '05-206441'),
  ('fund_code_gaa',                 '01-101101'),
  ('fund_code_igp',                 '05-206441-IGP'),
  -- At or below this amount the Campus Director approves; above it the
  -- University President does. In pesos.
  ('approver_threshold',            '50000'),
  ('approved_above_name',           NULL),
  ('approved_above_designation',    'University President'),
  -- Request for Quotation signatories.
  ('bac_vice_chairman_name',        NULL),
  ('bac_vice_chairman_designation', 'BAC Vice Chairman'),
  ('canvasser_name',                NULL),
  ('canvasser_designation',         'Canvasser')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;   -- keep values already set

-- Rollback
-- ALTER TABLE `purchase_requests` DROP COLUMN `fund_source`;
-- DELETE FROM `org_settings` WHERE `setting_key` IN
--   ('entity_full_name','entity_campus','entity_address','entity_telefax','entity_website',
--    'fund_code_stf','fund_code_gaa','fund_code_igp','approver_threshold',
--    'approved_above_name','approved_above_designation',
--    'bac_vice_chairman_name','bac_vice_chairman_designation','canvasser_name','canvasser_designation');
