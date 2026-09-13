-- Migration: rename role 'extension' → 'requestor' across the system,
-- and add 8 new context columns to purchase_requests for end-user-centric PRs.
--
-- Conceptual shift: the role was originally "Extension Officer" (a specific
-- office). It's now a generic Requestor — anyone (faculty, staff, dept rep)
-- filing a procurement request. The PR itself classifies what kind of request
-- it is via purpose_type, and captures department + justification.

-- ── Step 1: temporarily expand the ENUM to allow both old and new values ──
ALTER TABLE `users`
  MODIFY COLUMN `role`
    ENUM('admin','procurement','extension','supply','twg','requestor')
    NOT NULL DEFAULT 'extension';

-- ── Step 2: migrate existing data ──
UPDATE `users` SET `role` = 'requestor' WHERE `role` = 'extension';

-- ── Step 3: lock the ENUM to the new set (extension removed) ──
ALTER TABLE `users`
  MODIFY COLUMN `role`
    ENUM('admin','procurement','requestor','supply','twg')
    NOT NULL DEFAULT 'requestor';

-- ── Step 4: add Request Context fields to purchase_requests ──
ALTER TABLE `purchase_requests`
  ADD COLUMN `department`      VARCHAR(150) NULL                  AFTER `responsibility_center_code`,
  ADD COLUMN `purpose_type`    ENUM('personal','event','office','project') NOT NULL DEFAULT 'personal' AFTER `department`,
  ADD COLUMN `purpose`         TEXT         NULL                  AFTER `purpose_type`,
  ADD COLUMN `date_needed`     DATE         NULL                  AFTER `purpose`,
  ADD COLUMN `recommended_by`  VARCHAR(150) NULL                  AFTER `date_needed`,
  ADD COLUMN `event_name`      VARCHAR(200) NULL                  AFTER `recommended_by`,
  ADD COLUMN `event_date`      DATE         NULL                  AFTER `event_name`,
  ADD COLUMN `project_name`    VARCHAR(200) NULL                  AFTER `event_date`;

CREATE INDEX `idx_purpose_type` ON `purchase_requests` (`purpose_type`);
CREATE INDEX `idx_date_needed`  ON `purchase_requests` (`date_needed`);
