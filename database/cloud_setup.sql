-- ════════════════════════════════════════════════════════════════════════════
-- PRimeSys — Cloud Database Setup (TiDB / Aiven / other cloud MySQL)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Paste this entire file into TiDB Cloud's SQL Editor and click Run.
-- After this completes, run `node server/seed.js` locally to create the
-- default admin account.
--
-- Local XAMPP users: do NOT run this; use database/schema.sql + migrations.
-- ════════════════════════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS `primesys` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `primesys`;

-- ─── Users (parent table) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `users` (
  `id`                         INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `name`                       VARCHAR(100)    NOT NULL,
  `username`                   VARCHAR(50)     NULL,
  `email`                      VARCHAR(150)    NOT NULL,
  `password_hash`              VARCHAR(255)    NOT NULL,
  `role`                       ENUM('admin','extension','procurement','supply') NOT NULL DEFAULT 'extension',
  `is_active`                  TINYINT(1)      NOT NULL DEFAULT 1,
  `is_verified`                TINYINT(1)      NOT NULL DEFAULT 0,
  `verify_token`               VARCHAR(64)     NULL,
  `verify_expires`             DATETIME        NULL,
  `supplier_id`                INT             NULL,
  `fund_cluster`               VARCHAR(100)    NULL,
  `responsibility_center_code` VARCHAR(100)    NULL,
  `created_at`                 TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                 TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email`    (`email`),
  UNIQUE KEY `uq_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Quarters ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `quarters` (
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

-- ─── Suppliers ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `suppliers` (
  `id`             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(200)  NOT NULL,
  `contact_person` VARCHAR(100)  NULL,
  `address`        TEXT          NULL,
  `contact_number` VARCHAR(50)   NULL,
  `email`          VARCHAR(150)  NULL,
  `is_active`      TINYINT(1)    NOT NULL DEFAULT 1,
  `created_at`     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Notifications ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `notifications` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`        INT UNSIGNED NOT NULL,
  `message`        TEXT         NOT NULL,
  `type`           VARCHAR(50)  NOT NULL DEFAULT 'info',
  `reference_id`   INT UNSIGNED NULL,
  `reference_type` VARCHAR(50)  NULL,
  `is_read`        TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notifications_user_id`   (`user_id`),
  KEY `idx_notifications_user_read` (`user_id`, `is_read`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Purchase Requests ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `purchase_requests` (
  `id`                         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pr_number`                  VARCHAR(50)  NOT NULL,
  `quarter_id`                 INT UNSIGNED NULL,
  `title`                      VARCHAR(200) NULL,
  `fund_cluster`               VARCHAR(50)  NULL,
  `responsibility_center_code` VARCHAR(50)  NULL,
  `status`                     ENUM('draft','submitted','bidding','awarded','for_po','waiting_delivery','delivered','completed','cancelled') NOT NULL DEFAULT 'draft',
  `notes`                      TEXT         NULL,
  `created_by`                 INT UNSIGNED NOT NULL,
  `created_at`                 TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                 TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pr_number` (`pr_number`),
  KEY `idx_pr_status`     (`status`),
  KEY `idx_pr_quarter_id` (`quarter_id`),
  KEY `idx_pr_created_by` (`created_by`),
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`),
  FOREIGN KEY (`quarter_id`) REFERENCES `quarters`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Lots ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `lots` (
  `id`                  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `purchase_request_id` INT UNSIGNED  NOT NULL,
  `lot_number`          VARCHAR(20)   NOT NULL,
  `title`               VARCHAR(200)  NULL,
  `description`         TEXT          NULL,
  `status`              ENUM('draft','open','for_bidding','closed','awarded','cancelled') NOT NULL DEFAULT 'draft',
  `opening_date`        DATE          NULL,
  `closing_date`        DATE          NULL,
  `awarded_to`          VARCHAR(200)  NULL,
  `awarded_amount`      DECIMAL(15,2) NULL,
  `notes`               TEXT          NULL,
  `created_by`          INT UNSIGNED  NOT NULL,
  `created_at`          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lots_purchase_request_id` (`purchase_request_id`),
  KEY `idx_lots_status`              (`status`),
  FOREIGN KEY (`purchase_request_id`) REFERENCES `purchase_requests`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`created_by`)          REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Purchase Orders ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `purchase_orders` (
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
  UNIQUE KEY `uq_po_number`              (`po_number`),
  UNIQUE KEY `uq_pr_po`                  (`purchase_request_id`),
  KEY `idx_po_delivery_status`           (`delivery_status`),
  KEY `idx_po_purchase_request_id`       (`purchase_request_id`),
  FOREIGN KEY (`purchase_request_id`) REFERENCES `purchase_requests`(`id`),
  FOREIGN KEY (`issued_by`)           REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Bidding Results ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bidding_results` (
  `id`          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `lot_id`      INT UNSIGNED  NOT NULL,
  `supplier_id` INT UNSIGNED  NOT NULL,
  `amount`      DECIMAL(15,2) NOT NULL,
  `bid_date`    DATE          NOT NULL,
  `notes`       TEXT          NULL,
  `is_winner`   TINYINT(1)    NOT NULL DEFAULT 0,
  `created_by`  INT UNSIGNED  NOT NULL,
  `created_at`  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bidding_lot_id`      (`lot_id`),
  KEY `idx_bidding_supplier_id` (`supplier_id`),
  FOREIGN KEY (`lot_id`)      REFERENCES `lots`(`id`)      ON DELETE CASCADE,
  FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`),
  FOREIGN KEY (`created_by`)  REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Deliveries ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `deliveries` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `po_id`          INT UNSIGNED NOT NULL,
  `delivered_date` DATE         NOT NULL,
  `received_by`    INT UNSIGNED NOT NULL,
  `status`         ENUM('partial','complete') NOT NULL DEFAULT 'complete',
  `notes`          TEXT         NULL,
  `created_at`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_deliveries_po_id` (`po_id`),
  FOREIGN KEY (`po_id`)       REFERENCES `purchase_orders`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`received_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── PR Status Audit Log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pr_status_logs` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pr_id`       INT UNSIGNED NOT NULL,
  `changed_by`  INT UNSIGNED NOT NULL,
  `from_status` VARCHAR(50)  NULL,
  `to_status`   VARCHAR(50)  NOT NULL,
  `note`        TEXT         NULL,
  `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_psl_pr_id` (`pr_id`),
  FOREIGN KEY (`pr_id`)      REFERENCES `purchase_requests`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── PR Attachments ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pr_attachments` (
  `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `pr_id`         INT UNSIGNED NOT NULL,
  `filename`      VARCHAR(255) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `mimetype`      VARCHAR(100),
  `size`          INT UNSIGNED,
  `uploaded_by`   INT UNSIGNED NOT NULL,
  `created_at`    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`pr_id`)       REFERENCES `purchase_requests`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Delivery Attachments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `delivery_attachments` (
  `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `delivery_id`   INT UNSIGNED NOT NULL,
  `filename`      VARCHAR(255) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `mimetype`      VARCHAR(100),
  `size`          INT UNSIGNED,
  `uploaded_by`   INT UNSIGNED NOT NULL,
  `created_at`    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`delivery_id`) REFERENCES `deliveries`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Reminders ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `reminders` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `title`       VARCHAR(255) NOT NULL,
  `note`        TEXT,
  `remind_at`   DATETIME NOT NULL,
  `created_by`  INT UNSIGNED NOT NULL,
  `assigned_to` INT UNSIGNED NOT NULL,
  `pr_id`       INT UNSIGNED NULL,
  `lot_id`      INT UNSIGNED NULL,
  `is_sent`     TINYINT(1) NOT NULL DEFAULT 0,
  `is_done`     TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`created_by`)  REFERENCES `users`(`id`),
  FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`),
  FOREIGN KEY (`pr_id`)       REFERENCES `purchase_requests`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`lot_id`)      REFERENCES `lots`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Password Reset Tokens ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
  `id`         INT AUTO_INCREMENT PRIMARY KEY,
  `user_id`    INT         NOT NULL,
  `token_hash` VARCHAR(64) NOT NULL,
  `expires_at` DATETIME    NOT NULL,
  `used`       TINYINT(1)  NOT NULL DEFAULT 0,
  `created_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_prt_token_hash` (`token_hash`),
  INDEX `idx_prt_user_id`    (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Organization Settings ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `org_settings` (
  `setting_key`   VARCHAR(100) PRIMARY KEY,
  `setting_value` TEXT NULL,
  `updated_at`    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── PR Read Markers ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pr_reads` (
  `user_id` INT UNSIGNED NOT NULL,
  `pr_id`   INT UNSIGNED NOT NULL,
  `read_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `pr_id`),
  INDEX `idx_pr_reads_user` (`user_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)             ON DELETE CASCADE,
  FOREIGN KEY (`pr_id`)   REFERENCES `purchase_requests`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═════════════════════════════════════════════════════════════════════════════
-- Seed data: quarters + org settings (admin user is created by `node seed.js`)
-- ═════════════════════════════════════════════════════════════════════════════

INSERT IGNORE INTO `quarters` (`label`, `year`, `start_date`, `end_date`) VALUES
  ('Q1', YEAR(CURDATE()), CONCAT(YEAR(CURDATE()), '-01-01'), CONCAT(YEAR(CURDATE()), '-03-31')),
  ('Q2', YEAR(CURDATE()), CONCAT(YEAR(CURDATE()), '-04-01'), CONCAT(YEAR(CURDATE()), '-06-30')),
  ('Q3', YEAR(CURDATE()), CONCAT(YEAR(CURDATE()), '-07-01'), CONCAT(YEAR(CURDATE()), '-09-30')),
  ('Q4', YEAR(CURDATE()), CONCAT(YEAR(CURDATE()), '-10-01'), CONCAT(YEAR(CURDATE()), '-12-31'));

INSERT IGNORE INTO `org_settings` (`setting_key`, `setting_value`) VALUES
  ('fund_cluster',               NULL),
  ('responsibility_center_code', NULL);

-- Done. Now run `node server/seed.js` locally (with your .env pointing at TiDB)
-- to create the default admin account.
