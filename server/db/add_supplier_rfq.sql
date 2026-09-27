-- Migration: a supplier master list, and RFQs emailed to suppliers who answer
-- through a link, without an account.
--
-- 1. SUPPLIERS: kept once by Procurement (name, TIN, address, contact, email,
--    phone, PhilGEPS number) and marked active or blacklisted.
-- 2. RFQ_INVITATIONS: one per supplier per PR. The email carries a random
--    token; only its SHA-256 is stored. The supplier opens the link, enters
--    prices, and may revise them until the deadline. Online quotations stay
--    sealed (prices hidden) until the deadline passes.
-- 3. QUOTATIONS: which supplier (supplier_id), how it arrived (source), and
--    the terms the RFQ asks for (delivery period, warranty, price validity).
--
-- Run AFTER add_bac_evaluation.sql.
-- Rollback: the statements at the bottom of this file.

CREATE TABLE `suppliers` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(200) NOT NULL,
  `name_key`       VARCHAR(200) NOT NULL,   -- lower case, single spaces: one supplier per name
  `tin`            VARCHAR(50)  NULL,
  `address`        TEXT         NULL,
  `contact_person` VARCHAR(100) NULL,
  `email`          VARCHAR(150) NULL,
  `phone`          VARCHAR(50)  NULL,
  `philgeps_no`    VARCHAR(50)  NULL,
  `status`         ENUM('active','blacklisted') NOT NULL DEFAULT 'active',
  `status_note`    VARCHAR(500) NULL,
  `created_by`     INT UNSIGNED NOT NULL,
  `created_at`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_supplier_name_key` (`name_key`),
  CONSTRAINT `fk_suppliers_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `quotations`
  ADD COLUMN `supplier_id`     INT UNSIGNED NULL AFTER `purchase_request_id`,
  ADD COLUMN `source`          ENUM('manual','online') NOT NULL DEFAULT 'manual' AFTER `supplier_id`,
  ADD COLUMN `delivery_period` VARCHAR(100) NULL AFTER `notes`,
  ADD COLUMN `warranty`        VARCHAR(100) NULL AFTER `delivery_period`,
  ADD COLUMN `price_validity`  VARCHAR(100) NULL AFTER `warranty`,
  ADD KEY `idx_quotations_supplier` (`supplier_id`),
  ADD CONSTRAINT `fk_quotations_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE SET NULL;

CREATE TABLE `rfq_invitations` (
  `id`                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `purchase_request_id` INT UNSIGNED NOT NULL,
  `supplier_id`         INT UNSIGNED NOT NULL,
  `token_hash`          CHAR(64)     NOT NULL,
  `deadline`            DATETIME     NOT NULL,
  `sent_at`             DATETIME     NULL,
  `send_error`          VARCHAR(300) NULL,
  `reminded_at`         DATETIME     NULL,
  `opened_at`           DATETIME     NULL,
  `submitted_at`        DATETIME     NULL,
  `quotation_id`        INT UNSIGNED NULL,
  `created_by`          INT UNSIGNED NOT NULL,
  `created_at`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rfq_token` (`token_hash`),
  UNIQUE KEY `uq_rfq_pr_supplier` (`purchase_request_id`, `supplier_id`),
  KEY `idx_rfq_due` (`submitted_at`, `reminded_at`, `deadline`),
  CONSTRAINT `fk_rfq_pr`        FOREIGN KEY (`purchase_request_id`) REFERENCES `purchase_requests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rfq_supplier`  FOREIGN KEY (`supplier_id`)         REFERENCES `suppliers` (`id`),
  CONSTRAINT `fk_rfq_quotation` FOREIGN KEY (`quotation_id`)        REFERENCES `quotations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_rfq_user`      FOREIGN KEY (`created_by`)          REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback
-- DROP TABLE `rfq_invitations`;
-- ALTER TABLE `quotations` DROP FOREIGN KEY `fk_quotations_supplier`, DROP KEY `idx_quotations_supplier`,
--   DROP COLUMN `price_validity`, DROP COLUMN `warranty`, DROP COLUMN `delivery_period`, DROP COLUMN `source`, DROP COLUMN `supplier_id`;
-- DROP TABLE `suppliers`;
