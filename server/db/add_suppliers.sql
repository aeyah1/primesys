-- Migration: supplier profiles, kept by Procurement and Admin.
--
-- Each quotation the BAC enters is linked to the profile of the same name (canvass_bidders.supplier_id), so a
-- profile shows every request the supplier quoted on, its awards and its DQs, and the BAC can fill a quotation
-- from a profile. Earlier quotations link when a profile of their name is added.
--
-- Run AFTER add_dq_remarks.sql, BEFORE deploying the server that reads it. Safe to re-run (MariaDB).
-- Rollback:
--   ALTER TABLE `canvass_bidders` DROP FOREIGN KEY `fk_canvass_bidders_supplier`, DROP INDEX `idx_canvass_bidders_supplier`, DROP COLUMN `supplier_id`;
--   DROP TABLE `suppliers`;

CREATE TABLE IF NOT EXISTS `suppliers` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(200) NOT NULL,
  `name_key`       VARCHAR(200) NOT NULL,
  `address`        VARCHAR(500) NULL,
  `tin`            VARCHAR(50)  NULL,
  `philgeps_no`    VARCHAR(50)  NULL,
  `contact_person` VARCHAR(100) NULL,
  `designation`    VARCHAR(150) NULL,
  `phone`          VARCHAR(50)  NULL,
  `email`          VARCHAR(150) NULL,
  `status`         ENUM('active','blacklisted') NOT NULL DEFAULT 'active',
  `status_note`    VARCHAR(500) NULL,
  `created_by`     INT UNSIGNED NULL,
  `created_at`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_suppliers_name_key` (`name_key`),
  CONSTRAINT `fk_suppliers_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `canvass_bidders` ADD COLUMN IF NOT EXISTS `supplier_id` INT UNSIGNED NULL AFTER `dq_remarks`;
ALTER TABLE `canvass_bidders` ADD INDEX IF NOT EXISTS `idx_canvass_bidders_supplier` (`supplier_id`);
ALTER TABLE `canvass_bidders`
  ADD CONSTRAINT `fk_canvass_bidders_supplier` FOREIGN KEY IF NOT EXISTS (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE SET NULL;
