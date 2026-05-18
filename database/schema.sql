-- PRimeSys: Web-Based Procurement Management System
-- Full Schema — drop and recreate cleanly

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

DROP TABLE IF EXISTS `purchase_orders`;
DROP TABLE IF EXISTS `lots`;
DROP TABLE IF EXISTS `purchase_requests`;
DROP TABLE IF EXISTS `quarters`;
DROP TABLE IF EXISTS `notifications`;
DROP TABLE IF EXISTS `users`;

SET FOREIGN_KEY_CHECKS = 1;

-- ─── Users ────────────────────────────────────────────────────────────────────

CREATE TABLE `users` (
  `id`            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `name`          VARCHAR(100)    NOT NULL,
  `username`      VARCHAR(50)     NULL,
  `email`         VARCHAR(150)    NOT NULL,
  `password_hash` VARCHAR(255)    NOT NULL,
  `role`          ENUM('admin','procurement','extension','supply') NOT NULL DEFAULT 'extension',
  `is_active`     TINYINT(1)      NOT NULL DEFAULT 1,
  `created_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email`    (`email`),
  UNIQUE KEY `uq_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Notifications ────────────────────────────────────────────────────────────

CREATE TABLE `notifications` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`        INT UNSIGNED NOT NULL,
  `message`        TEXT         NOT NULL,
  `type`           VARCHAR(50)  NOT NULL DEFAULT 'info',
  `reference_id`   INT UNSIGNED NULL,
  `reference_type` VARCHAR(50)  NULL,
  `is_read`        TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_is_read` (`is_read`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Quarters ─────────────────────────────────────────────────────────────────

CREATE TABLE `quarters` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `label`      VARCHAR(10)  NOT NULL,
  `year`       YEAR         NOT NULL,
  `start_date` DATE         NOT NULL,
  `end_date`   DATE         NOT NULL,
  `is_active`  TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_quarter_year` (`label`, `year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Purchase Requests ────────────────────────────────────────────────────────
-- One PR covers multiple events for an entire quarter.
-- Created by procurement after reviewing submitted event requests.

CREATE TABLE `purchase_requests` (
  `id`                         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pr_number`                  VARCHAR(50)  NOT NULL,
  `quarter_id`                 INT UNSIGNED NULL,
  `title`                      VARCHAR(200) NULL,
  `fund_cluster`               VARCHAR(50)  NULL,
  `responsibility_center_code` VARCHAR(50)  NULL,
  `status`                     ENUM('draft','submitted','bidding','for_po','completed','cancelled') NOT NULL DEFAULT 'draft',
  `notes`                      TEXT         NULL,
  `created_by`                 INT UNSIGNED NOT NULL,
  `created_at`                 TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                 TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pr_number` (`pr_number`),
  KEY `idx_status`      (`status`),
  KEY `idx_created_by`  (`created_by`),
  KEY `idx_quarter_id`  (`quarter_id`),
  FOREIGN KEY (`created_by`)  REFERENCES `users`(`id`),
  FOREIGN KEY (`quarter_id`)  REFERENCES `quarters`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Purchase Orders ──────────────────────────────────────────────────────────
-- One PO per PR. Issued after external bidding; procurement enters supplier.
-- Delivery tracking lives here (pending → partial → delivered).

CREATE TABLE `purchase_orders` (
  `id`                     INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `po_number`              VARCHAR(50)   NOT NULL,
  `purchase_request_id`    INT UNSIGNED  NOT NULL,
  `supplier_name`          VARCHAR(200)  NOT NULL,
  `supplier_contact`       VARCHAR(100)  NULL,
  `supplier_address`       TEXT          NULL,
  `issued_date`            DATE          NOT NULL,
  `total_amount`           DECIMAL(15,2) NOT NULL,
  `expected_delivery_date` DATE          NULL,
  `delivery_status`        ENUM('pending','partial','delivered') NOT NULL DEFAULT 'pending',
  `delivery_date`          DATE          NULL,
  `delivery_notes`         TEXT          NULL,
  `notes`                  TEXT          NULL,
  `po_status`              ENUM('pending_approval','approved') NOT NULL DEFAULT 'approved',
  `issued_by`              INT UNSIGNED  NOT NULL,
  `created_at`             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_po_number` (`po_number`),
  UNIQUE KEY `uq_pr_po`     (`purchase_request_id`),
  KEY `idx_delivery_status` (`delivery_status`),
  FOREIGN KEY (`purchase_request_id`) REFERENCES `purchase_requests`(`id`),
  FOREIGN KEY (`issued_by`)           REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Lots & Bidding ──────────────────────────────────────────────────────────
-- Each PR can be divided into lots for RA 9184 bidding.
-- Procurement creates lots, opens bidding, then awards to a supplier.
-- When all lots are awarded, PR moves to 'for_po' automatically.

CREATE TABLE `lots` (
  `id`                  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `purchase_request_id` INT UNSIGNED  NOT NULL,
  `lot_number`          VARCHAR(20)   NOT NULL,
  `title`               VARCHAR(200)  NULL,
  `description`         TEXT          NULL,
  `status`              ENUM('draft','open','closed','awarded','cancelled') NOT NULL DEFAULT 'draft',
  `opening_date`        DATE          NULL,
  `closing_date`        DATE          NULL,
  `awarded_to`          VARCHAR(200)  NULL,
  `awarded_amount`      DECIMAL(15,2) NULL,
  `notes`               TEXT          NULL,
  `created_by`          INT UNSIGNED  NOT NULL,
  `created_at`          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pr_id`  (`purchase_request_id`),
  KEY `idx_status` (`status`),
  FOREIGN KEY (`purchase_request_id`) REFERENCES `purchase_requests`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`created_by`)          REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pr_items` (
  `id`             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `pr_id`          INT UNSIGNED  NOT NULL,
  `group_label`    VARCHAR(255)  NULL,
  `item_name`      VARCHAR(500)  NOT NULL,
  `quantity`       DECIMAL(10,2) NOT NULL DEFAULT 1,
  `unit`           VARCHAR(50)   NULL,
  `estimated_cost` DECIMAL(15,2) NULL,
  `notes`          TEXT          NULL,
  `created_at`     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pr_id` (`pr_id`),
  FOREIGN KEY (`pr_id`) REFERENCES `purchase_requests`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- If table already exists: ALTER TABLE `pr_items` ADD COLUMN `group_label` VARCHAR(255) NULL AFTER `pr_id`, MODIFY COLUMN `item_name` VARCHAR(500) NOT NULL;

CREATE TABLE IF NOT EXISTS `lot_items` (
  `id`             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `lot_id`         INT UNSIGNED  NOT NULL,
  `item_name`      VARCHAR(255)  NOT NULL,
  `quantity`       DECIMAL(10,2) NOT NULL DEFAULT 1,
  `unit`           VARCHAR(50)   NULL,
  `estimated_cost` DECIMAL(15,2) NULL,
  `created_at`     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lot_id` (`lot_id`),
  FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Seed Data ────────────────────────────────────────────────────────────────

-- Default admin account  (password: Admin@1234)
INSERT INTO `users` (`name`, `email`, `password_hash`, `role`) VALUES
('Administrator', 'admin@primesys.local', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin');

-- Current fiscal year quarters
INSERT INTO `quarters` (`label`, `year`, `start_date`, `end_date`, `is_active`) VALUES
('Q1', 2026, '2026-01-01', '2026-03-31', 0),
('Q2', 2026, '2026-04-01', '2026-06-30', 1),
('Q3', 2026, '2026-07-01', '2026-09-30', 0),
('Q4', 2026, '2026-10-01', '2026-12-31', 0);
