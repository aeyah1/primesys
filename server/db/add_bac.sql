-- Migration: the Bids and Awards Committee (BAC) approves awards.
--
-- Until now Procurement recorded an award and it was final at once: the lot was
-- created 'awarded' and a purchase order could follow. In the campus's actual
-- process the BAC resolves to recommend the award, the Head of the Procuring
-- Entity approves it, the supplier is served a Notice of Award, and only then
-- is a purchase order issued.
--
-- 1. A `bac` ROLE for the committee's members. Assigned by an admin in User
--    Management, never at sign-up.
-- 2. A lot can now be 'recommended': Procurement's award waiting for the BAC.
--    It holds its items (they can't be awarded twice) but no PO can be issued
--    on it until the BAC approves it.
-- 3. BAC_RESOLUTIONS: one per approval, numbered per year (2026-001), naming
--    the awards it approved through lots.resolution_id. Printed as the BAC
--    Resolution, and each supplier's awards in it as a Notice of Award.
-- 4. SETTINGS: whether awards need BAC approval (on), and the committee's
--    chairman and members as they print on the resolution.
--
-- Awards recorded before this stay 'awarded' with no resolution.
-- Run AFTER add_procurement_mode.sql.
-- Rollback: the statements at the bottom of this file.

ALTER TABLE `users`
  MODIFY `role` ENUM('admin','procurement','requestor','supply','twg','bac') NOT NULL DEFAULT 'requestor';

ALTER TABLE `lots`
  MODIFY `status` ENUM('draft','open','closed','recommended','awarded','cancelled') NOT NULL DEFAULT 'draft';

CREATE TABLE `bac_resolutions` (
  `id`                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `resolution_number`   VARCHAR(30)  NOT NULL,
  `purchase_request_id` INT UNSIGNED NOT NULL,
  `resolved_on`         DATE         NOT NULL,
  `notes`               TEXT         NULL,
  `approved_by`         INT UNSIGNED NOT NULL,
  `created_at`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_resolution_number` (`resolution_number`),
  KEY `idx_bac_resolutions_pr` (`purchase_request_id`),
  CONSTRAINT `fk_bac_resolutions_pr`   FOREIGN KEY (`purchase_request_id`) REFERENCES `purchase_requests` (`id`),
  CONSTRAINT `fk_bac_resolutions_user` FOREIGN KEY (`approved_by`)         REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `lots`
  ADD COLUMN `resolution_id` INT UNSIGNED NULL AFTER `quotation_id`,
  ADD KEY `idx_lots_resolution_id` (`resolution_id`),
  ADD CONSTRAINT `fk_lots_resolution` FOREIGN KEY (`resolution_id`) REFERENCES `bac_resolutions` (`id`) ON DELETE SET NULL;

INSERT INTO `org_settings` (`setting_key`, `setting_value`) VALUES
  ('bac_approval_required',     '1'),
  ('bac_chairman_name',         NULL),
  ('bac_chairman_designation',  'BAC Chairman'),
  ('bac_members',               NULL)
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;

-- Rollback (first move any 'bac' users to another role, and approve or cancel
-- any 'recommended' lots, or the ENUM changes will fail)
-- ALTER TABLE `lots` DROP FOREIGN KEY `fk_lots_resolution`, DROP KEY `idx_lots_resolution_id`, DROP COLUMN `resolution_id`;
-- DROP TABLE `bac_resolutions`;
-- ALTER TABLE `lots`  MODIFY `status` ENUM('draft','open','closed','awarded','cancelled') NOT NULL DEFAULT 'draft';
-- ALTER TABLE `users` MODIFY `role` ENUM('admin','procurement','requestor','supply','twg') NOT NULL DEFAULT 'requestor';
-- DELETE FROM `org_settings` WHERE `setting_key` IN ('bac_approval_required','bac_chairman_name','bac_chairman_designation','bac_members');
