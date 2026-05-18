-- PRimeSys — Full Migration (safe to re-run: uses IF NOT EXISTS)
-- Run this in phpMyAdmin SQL tab. If you get a partial error, run it again.

-- ─── 1. User columns ─────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS _add_col;

DELIMITER $$
CREATE PROCEDURE _add_col(IN tbl VARCHAR(64), IN col VARCHAR(64), IN defn TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = col
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', defn);
    PREPARE st FROM @sql;
    EXECUTE st;
    DEALLOCATE PREPARE st;
  END IF;
END$$
DELIMITER ;

CALL _add_col('users', 'is_verified',    'TINYINT(1) NOT NULL DEFAULT 0');
CALL _add_col('users', 'verify_token',   'VARCHAR(64) NULL');
CALL _add_col('users', 'verify_expires', 'DATETIME NULL');
CALL _add_col('users', 'supplier_id',    'INT NULL');

UPDATE users SET is_verified = 1 WHERE verify_token IS NULL;

DROP PROCEDURE IF EXISTS _add_col;

-- ─── 2. Role ENUM ────────────────────────────────────────────────────────────
ALTER TABLE users
  MODIFY COLUMN role ENUM('admin','extension','procurement','supply') NOT NULL DEFAULT 'extension';

-- ─── 3. Suppliers table ───────────────────────────────────────────────────────
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

-- ─── 4. Lots table (create first so ENUM alter below works) ──────────────────
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
  KEY `idx_pr_id`  (`purchase_request_id`),
  KEY `idx_status` (`status`),
  FOREIGN KEY (`purchase_request_id`) REFERENCES `purchase_requests`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`created_by`)          REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 5. Purchase orders table (create before deliveries FK) ──────────────────
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

-- ─── 6. PR status ENUM (add bidding phases) ──────────────────────────────────
ALTER TABLE purchase_requests
  MODIFY COLUMN status
    ENUM('draft','submitted','bidding','awarded','for_po','waiting_delivery','delivered','completed','cancelled')
    NOT NULL DEFAULT 'draft';

-- ─── 7. Lot status ENUM (add for_bidding — table now guaranteed to exist) ────
ALTER TABLE lots
  MODIFY COLUMN status
    ENUM('draft','open','for_bidding','closed','awarded','cancelled')
    NOT NULL DEFAULT 'draft';

-- ─── 8. Bidding results ───────────────────────────────────────────────────────
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
  KEY `idx_lot_id`      (`lot_id`),
  KEY `idx_supplier_id` (`supplier_id`),
  FOREIGN KEY (`lot_id`)      REFERENCES `lots`(`id`)      ON DELETE CASCADE,
  FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`),
  FOREIGN KEY (`created_by`)  REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 9. Deliveries ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `deliveries` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `po_id`          INT UNSIGNED NOT NULL,
  `delivered_date` DATE         NOT NULL,
  `received_by`    INT UNSIGNED NOT NULL,
  `status`         ENUM('partial','complete') NOT NULL DEFAULT 'complete',
  `notes`          TEXT         NULL,
  `created_at`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_po_id` (`po_id`),
  FOREIGN KEY (`po_id`)       REFERENCES `purchase_orders`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`received_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 10. PR status audit log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pr_status_logs` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pr_id`       INT UNSIGNED NOT NULL,
  `changed_by`  INT UNSIGNED NOT NULL,
  `from_status` VARCHAR(50)  NULL,
  `to_status`   VARCHAR(50)  NOT NULL,
  `note`        TEXT         NULL,
  `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pr_id` (`pr_id`),
  FOREIGN KEY (`pr_id`)      REFERENCES `purchase_requests`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
