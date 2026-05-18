-- ════════════════════════════════════════════════════════════════════════════
-- PRimeSys — Cloud Database Patch v1
-- ════════════════════════════════════════════════════════════════════════════
--
-- Fixes for tables/columns missing from cloud_setup.sql v1:
--   1. pr_items table (referenced by pr/po/delivery/reports controllers)
--   2. lot_items table (referenced by lots controller)
--   3. quarters.budget column (referenced by quarters + reports controllers)
--   4. quarters.start_date / end_date — make nullable to match controller usage
--
-- Safe to re-run. Run this after cloud_setup.sql against the same cluster:
--   node server/scripts/setup-cloud-db.js   ← still works the same
--   (or paste this whole file into TiDB SQL Editor with `primesys` selected)
-- ════════════════════════════════════════════════════════════════════════════

USE `primesys`;

-- ─── 1. pr_items ─────────────────────────────────────────────────────────────
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
  KEY `idx_pr_items_pr_id` (`pr_id`),
  FOREIGN KEY (`pr_id`) REFERENCES `purchase_requests`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 2. lot_items ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `lot_items` (
  `id`             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `lot_id`         INT UNSIGNED  NOT NULL,
  `item_name`      VARCHAR(255)  NOT NULL,
  `quantity`       DECIMAL(10,2) NOT NULL DEFAULT 1,
  `unit`           VARCHAR(50)   NULL,
  `estimated_cost` DECIMAL(15,2) NULL,
  `created_at`     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lot_items_lot_id` (`lot_id`),
  FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 3. quarters.budget column ───────────────────────────────────────────────
-- ALTER ... ADD COLUMN IF NOT EXISTS is supported on TiDB 8.x
ALTER TABLE `quarters` ADD COLUMN IF NOT EXISTS `budget` DECIMAL(15,2) NULL AFTER `year`;

-- ─── 4. quarters dates — make nullable ───────────────────────────────────────
-- (The create-quarter API doesn't accept these, so they must be optional.)
ALTER TABLE `quarters` MODIFY COLUMN `start_date` DATE NULL;
ALTER TABLE `quarters` MODIFY COLUMN `end_date`   DATE NULL;
