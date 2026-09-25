-- Migration: departments, and the head who signs "Requested by" on the PR form.
--
-- On the printed form the requesting party is the HEAD of the office, not the
-- person who typed the request in. So each department carries its head's name
-- and designation, and a PR freezes both when it is filed - the same rule the
-- fund codes already follow, so a change of chair never rewrites PRs already
-- on record.
--
-- Office/Section was free text, which is why the same office appears as both
-- "DCS Department" and "HR department". Existing values are kept and matched to
-- a department where the text obviously refers to one; anything unmatched keeps
-- its text and simply has no department linked.
--
-- A department with no head_name is still usable: the form prints a blank
-- signature line for the head to sign by hand.
--
-- Run BEFORE starting the server code that reads these fields.
-- Rollback: the statements at the bottom of this file.

CREATE TABLE IF NOT EXISTS `departments` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Short form printed in the form's Office/Section cell, e.g. "DCS".
  `code`              VARCHAR(20)  NOT NULL,
  `name`              VARCHAR(150) NOT NULL,
  -- The head who signs "Requested by"; blank until the campus supplies it.
  `head_name`         VARCHAR(150) NULL,
  `head_designation`  VARCHAR(150) NULL,
  `is_active`         TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_department_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The office a person encodes for; pre-fills the PR form, still changeable there.
ALTER TABLE `users`
  ADD COLUMN `department_id` INT UNSIGNED NULL AFTER `designation`,
  ADD CONSTRAINT `fk_users_department` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL;

-- The department a PR was filed for, and its head as it stood that day.
ALTER TABLE `purchase_requests`
  ADD COLUMN `department_id`     INT UNSIGNED NULL AFTER `department`,
  ADD COLUMN `requested_by_name` VARCHAR(150) NULL AFTER `created_by`,
  ADD CONSTRAINT `fk_pr_department` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL;

CREATE INDEX `idx_pr_department_id` ON `purchase_requests` (`department_id`);

-- The one department the campus has supplied so far (from its own PR form).
INSERT INTO `departments` (`code`, `name`, `head_name`, `head_designation`) VALUES
  ('DCS', 'Department of Computer Studies', NULL, 'Department Chair, DCS')
ON DUPLICATE KEY UPDATE `code` = `code`;

-- Link existing PRs whose free text already names a department, by code or by
-- full name, ignoring case and surrounding spaces.
--
-- Deliberately NOT creating a department for every distinct string found: that
-- turns typos into offices ("DCS Department" alongside "DCS") which an admin
-- then cannot merge away, because each is referenced by a PR. An unmatched PR
-- simply keeps its text, which is what the form prints either way, and an admin
-- creates the real offices under Settings > Organization.
UPDATE `purchase_requests` pr
  JOIN `departments` d
    ON LOWER(TRIM(pr.department)) IN (LOWER(d.code), LOWER(d.name))
   SET pr.department_id = d.id
 WHERE pr.department_id IS NULL;

-- A PR filed before this change keeps naming its creator as the requesting party,
-- since no head was recorded at the time.
UPDATE `purchase_requests` pr
  JOIN `users` u ON u.id = pr.created_by
   SET pr.requested_by_name = u.name
 WHERE pr.requested_by_name IS NULL;

-- Rollback
-- ALTER TABLE `purchase_requests` DROP FOREIGN KEY `fk_pr_department`;
-- ALTER TABLE `purchase_requests` DROP COLUMN `department_id`, DROP COLUMN `requested_by_name`;
-- ALTER TABLE `users` DROP FOREIGN KEY `fk_users_department`;
-- ALTER TABLE `users` DROP COLUMN `department_id`;
-- DROP TABLE `departments`;
