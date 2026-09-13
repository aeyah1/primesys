-- ════════════════════════════════════════════════════════════════════════════
-- PRimeSys: Web-Based Procurement Monitoring System
-- Complete database for a FRESH local install (XAMPP / MariaDB 10.4+)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Import this ONE file, either:
--   * phpMyAdmin > Import > choose this file > Import, or
--   * C:\xampp\mysql\bin\mysql.exe -u root < database/schema.sql
--
-- It creates the `primesys` database, every table the app uses (all past
-- migrations are already included), the admin account, this year's quarters,
-- and the organization settings keys.
--
-- Do NOT run the server/db/*.sql migrations after this file. They exist only
-- to upgrade an older database, and some of them would undo current columns.
--
-- It never drops anything: if `primesys` already has these tables, the import
-- stops at the first CREATE TABLE instead of overwriting data. To start over,
-- drop the `primesys` database first (that deletes all of its data).
--
-- Admin sign-in:  username `admin`  /  password `Admin@1234`
-- Change the password after the first sign-in (Settings > Security).
-- ════════════════════════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS `primesys` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `primesys`;

SET NAMES utf8mb4;

-- ─── Users ──────────────────────────────────────────────────────────────────
-- Public sign-up may request procurement / supply / twg; those accounts start
-- with is_approved = 0 until an admin approves them. Everyone else is approved.
CREATE TABLE `users` (
  `id`                         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`                       VARCHAR(100) NOT NULL,
  `username`                   VARCHAR(50)  NULL,
  `email`                      VARCHAR(150) NOT NULL,
  `password_hash`              VARCHAR(255) NOT NULL,
  `role`                       ENUM('admin','procurement','requestor','supply','twg') NOT NULL DEFAULT 'requestor',
  `is_active`                  TINYINT(1)   NOT NULL DEFAULT 1,
  `is_verified`                TINYINT(1)   NOT NULL DEFAULT 0,
  `is_approved`                TINYINT(1)   NOT NULL DEFAULT 1,
  -- Sign-in tokens carry this number; changing or resetting the password
  -- raises it, so every token issued before stops working.
  `token_version`              INT UNSIGNED NOT NULL DEFAULT 0,
  `verify_token`               VARCHAR(64)  NULL,
  `verify_expires`             DATETIME     NULL,
  `fund_cluster`               VARCHAR(100) NULL,
  `responsibility_center_code` VARCHAR(100) NULL,
  `created_at`                 TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                 TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email`    (`email`),
  UNIQUE KEY `uq_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Quarters ───────────────────────────────────────────────────────────────
-- Scope PR numbering (PR-{year}-{Qn}-{nnn}) and quarterly budgets / reports.
CREATE TABLE `quarters` (
  `id`         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `label`      VARCHAR(10)   NOT NULL,
  `year`       YEAR          NOT NULL,
  `budget`     DECIMAL(15,2) NULL,
  `start_date` DATE          NULL,
  `end_date`   DATE          NULL,
  `is_active`  TINYINT(1)    NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_quarter_year` (`label`, `year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Organization settings ──────────────────────────────────────────────────
CREATE TABLE `org_settings` (
  `setting_key`   VARCHAR(100) NOT NULL,
  `setting_value` TEXT         NULL,
  `updated_at`    DATETIME     NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Purchase requests ──────────────────────────────────────────────────────
-- Status flow and who may change it: server/utils/prWorkflow.js.
-- A deleted PR is kept (deleted_at / deleted_by) and listed under Archive.
CREATE TABLE `purchase_requests` (
  `id`                         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pr_number`                  VARCHAR(50)  NOT NULL,
  `quarter_id`                 INT UNSIGNED NULL,
  `title`                      VARCHAR(200) NULL,
  `fund_cluster`               VARCHAR(50)  NULL,
  `responsibility_center_code` VARCHAR(50)  NULL,
  `department`                 VARCHAR(150) NULL,
  `purpose_type`               ENUM('personal','event','office','project') NOT NULL DEFAULT 'personal',
  `purpose`                    TEXT         NULL,
  `date_needed`                DATE         NULL,
  `recommended_by`             VARCHAR(150) NULL,
  `event_name`                 VARCHAR(200) NULL,
  `event_date`                 DATE         NULL,
  `project_name`               VARCHAR(200) NULL,
  `category`                   ENUM('hardware','office_supplies','lab_educational','furniture','food_catering','event_supplies') NOT NULL DEFAULT 'office_supplies',
  `status`                     ENUM('draft','submitted','twg_review','revision_requested','rejected','bidding','for_po','completed','cancelled') NOT NULL DEFAULT 'draft',
  `notes`                      TEXT         NULL,
  `created_by`                 INT UNSIGNED NOT NULL,
  `twg_reviewed_by`            INT UNSIGNED NULL,
  `twg_reviewed_at`            TIMESTAMP    NULL DEFAULT NULL,
  `twg_comment`                TEXT         NULL,
  `deleted_at`                 TIMESTAMP    NULL DEFAULT NULL,
  `deleted_by`                 INT UNSIGNED NULL,
  `created_at`                 TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                 TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pr_number`     (`pr_number`),
  KEY `idx_status`              (`status`),
  KEY `idx_created_by`          (`created_by`),
  KEY `idx_quarter_id`          (`quarter_id`),
  KEY `idx_pr_category`         (`category`),
  KEY `idx_purpose_type`        (`purpose_type`),
  KEY `idx_date_needed`         (`date_needed`),
  KEY `idx_pr_deleted_at`       (`deleted_at`),
  CONSTRAINT `fk_pr_created_by`   FOREIGN KEY (`created_by`)      REFERENCES `users` (`id`),
  CONSTRAINT `fk_pr_quarter`      FOREIGN KEY (`quarter_id`)      REFERENCES `quarters` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pr_twg_reviewer` FOREIGN KEY (`twg_reviewed_by`) REFERENCES `users` (`id`)    ON DELETE SET NULL,
  CONSTRAINT `fk_pr_deleted_by`   FOREIGN KEY (`deleted_by`)      REFERENCES `users` (`id`)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `pr_items` (
  `id`             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `pr_id`          INT UNSIGNED  NOT NULL,
  `group_label`    VARCHAR(255)  NULL,
  `item_name`      VARCHAR(500)  NOT NULL,
  `quantity`       DECIMAL(10,2) NOT NULL DEFAULT 1,
  `unit`           VARCHAR(50)   NULL,
  `estimated_cost` DECIMAL(15,2) NULL,
  `notes`          TEXT          NULL,
  -- Dropped from the procurement (e.g. no supplier could offer it), with why.
  `dropped_at`     DATETIME      NULL,
  `dropped_by`     INT UNSIGNED  NULL,
  `drop_reason`    VARCHAR(500)  NULL,
  `created_at`     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pr_items_pr_id` (`pr_id`),
  CONSTRAINT `fk_pr_items_pr`         FOREIGN KEY (`pr_id`)      REFERENCES `purchase_requests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pr_items_dropped_by` FOREIGN KEY (`dropped_by`) REFERENCES `users` (`id`)             ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `pr_attachments` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pr_id`         INT UNSIGNED NOT NULL,
  `filename`      VARCHAR(255) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `mimetype`      VARCHAR(100) NULL,
  `size`          INT UNSIGNED NULL,
  `uploaded_by`   INT UNSIGNED NOT NULL,
  `created_at`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pr_attachments_pr_id` (`pr_id`),
  CONSTRAINT `fk_pr_attachments_pr`   FOREIGN KEY (`pr_id`)       REFERENCES `purchase_requests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pr_attachments_user` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit trail: one row per status change (written by prWorkflow.changePRStatus).
CREATE TABLE `pr_status_logs` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pr_id`       INT UNSIGNED NOT NULL,
  `changed_by`  INT UNSIGNED NOT NULL,
  `from_status` VARCHAR(50)  NULL,
  `to_status`   VARCHAR(50)  NOT NULL,
  `note`        TEXT         NULL,
  `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_psl_pr_id` (`pr_id`),
  CONSTRAINT `fk_psl_pr`   FOREIGN KEY (`pr_id`)      REFERENCES `purchase_requests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_psl_user` FOREIGN KEY (`changed_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-user "I have viewed this PR" markers.
CREATE TABLE `pr_reads` (
  `user_id` INT UNSIGNED NOT NULL,
  `pr_id`   INT UNSIGNED NOT NULL,
  `read_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `pr_id`),
  KEY `idx_pr_reads_pr` (`pr_id`),
  CONSTRAINT `fk_pr_reads_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)             ON DELETE CASCADE,
  CONSTRAINT `fk_pr_reads_pr`   FOREIGN KEY (`pr_id`)   REFERENCES `purchase_requests` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── TWG review areas ───────────────────────────────────────────────────────
-- Which PR categories each TWG member reviews (set by an admin in User
-- Management). A submitted PR goes only to the members whose areas include
-- its category (server/utils/twgAreas.js). Keep the category list in step with
-- purchase_requests.category.
CREATE TABLE `twg_assignments` (
  `user_id`     INT UNSIGNED NOT NULL,
  `category`    ENUM('hardware','office_supplies','lab_educational','furniture','food_catering','event_supplies') NOT NULL,
  `assigned_by` INT UNSIGNED NULL,
  `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `category`),
  KEY `idx_twg_assignments_category` (`category`),
  CONSTRAINT `fk_twg_assignments_user` FOREIGN KEY (`user_id`)     REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_twg_assignments_by`   FOREIGN KEY (`assigned_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Canvass: quotations ────────────────────────────────────────────────────
-- Each supplier's quoted unit price per PR item, for the Abstract of
-- Quotations and the award. Items a supplier didn't quote have no row.
CREATE TABLE `quotations` (
  `id`                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `purchase_request_id` INT UNSIGNED NOT NULL,
  `supplier_name`       VARCHAR(200) NOT NULL,
  `supplier_contact`    VARCHAR(100) NULL,
  `supplier_address`    TEXT         NULL,
  `supplier_phone`      VARCHAR(50)  NULL,
  `supplier_email`      VARCHAR(150) NULL,
  `supplier_tin`        VARCHAR(50)  NULL,
  `quoted_at`           DATE         NULL,
  `notes`               TEXT         NULL,
  `created_by`          INT UNSIGNED NOT NULL,
  `created_at`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_quotations_pr_id` (`purchase_request_id`),
  CONSTRAINT `fk_quotations_pr`   FOREIGN KEY (`purchase_request_id`) REFERENCES `purchase_requests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_quotations_user` FOREIGN KEY (`created_by`)          REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `quotation_items` (
  `quotation_id` INT UNSIGNED  NOT NULL,
  `pr_item_id`   INT UNSIGNED  NOT NULL,
  `unit_price`   DECIMAL(15,2) NOT NULL,
  PRIMARY KEY (`quotation_id`, `pr_item_id`),
  KEY `idx_quotation_items_pr_item` (`pr_item_id`),
  CONSTRAINT `fk_quotation_items_quotation` FOREIGN KEY (`quotation_id`) REFERENCES `quotations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_quotation_items_pr_item`   FOREIGN KEY (`pr_item_id`)   REFERENCES `pr_items` (`id`)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Lots & awards ──────────────────────────────────────────────────────────
-- A lot records the supplier awarded some of a PR's items (lot_items with
-- pr_item_id; different items may go to different suppliers), maybe from a
-- quotation, and the purchase order issued for it (po_id, one supplier's POs).
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
  `supplier_contact`    VARCHAR(100)  NULL,
  `supplier_address`    TEXT          NULL,
  `supplier_phone`      VARCHAR(50)   NULL,
  `supplier_email`      VARCHAR(150)  NULL,
  `supplier_tin`        VARCHAR(50)   NULL,
  `notes`               TEXT          NULL,
  `quotation_id`        INT UNSIGNED  NULL,
  `po_id`               INT UNSIGNED  NULL,   -- FK added after purchase_orders, below
  `created_by`          INT UNSIGNED  NOT NULL,
  `created_at`          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lots_pr_id`  (`purchase_request_id`),
  KEY `idx_lots_status` (`status`),
  KEY `idx_lots_quotation_id` (`quotation_id`),
  KEY `idx_lots_po_id` (`po_id`),
  CONSTRAINT `fk_lots_pr`        FOREIGN KEY (`purchase_request_id`) REFERENCES `purchase_requests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lots_user`      FOREIGN KEY (`created_by`)          REFERENCES `users` (`id`),
  CONSTRAINT `fk_lots_quotation` FOREIGN KEY (`quotation_id`)        REFERENCES `quotations` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `lot_items` (
  `id`             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `lot_id`         INT UNSIGNED  NOT NULL,
  `pr_item_id`     INT UNSIGNED  NULL,       -- the PR item this award covers (NULL: an extra line)
  `item_name`      VARCHAR(500)  NOT NULL,   -- as long as a PR item name: awards copy them
  `quantity`       DECIMAL(10,2) NOT NULL DEFAULT 1,
  `unit`           VARCHAR(50)   NULL,
  `estimated_cost` DECIMAL(15,2) NULL,
  `unit_price`     DECIMAL(15,2) NULL,       -- the awarded (quoted) price; NULL for a lump-sum award
  `created_at`     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lot_items_lot_id` (`lot_id`),
  KEY `idx_lot_items_pr_item` (`pr_item_id`),
  CONSTRAINT `fk_lot_items_lot`     FOREIGN KEY (`lot_id`)     REFERENCES `lots` (`id`)     ON DELETE CASCADE,
  CONSTRAINT `fk_lot_items_pr_item` FOREIGN KEY (`pr_item_id`) REFERENCES `pr_items` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Purchase orders ────────────────────────────────────────────────────────
-- One PO per supplier's awards (lots.po_id), so a PR can have several active
-- POs. A cancelled PO stays on record; its awards are cancelled with it and
-- their items can be awarded again.
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
  `po_status`              ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  `cancelled_at`           TIMESTAMP     NULL DEFAULT NULL,
  `cancelled_by`           INT UNSIGNED  NULL,
  `cancel_reason`          TEXT          NULL,
  -- The latest change to the expected delivery date, and why.
  `rescheduled_at`         DATETIME      NULL,
  `reschedule_reason`      VARCHAR(500)  NULL,
  `issued_by`              INT UNSIGNED  NOT NULL,
  `created_at`             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_po_number`               (`po_number`),
  KEY `idx_po_purchase_request_id`        (`purchase_request_id`),
  KEY `idx_delivery_status`               (`delivery_status`),
  CONSTRAINT `fk_po_pr`           FOREIGN KEY (`purchase_request_id`) REFERENCES `purchase_requests` (`id`),
  CONSTRAINT `fk_po_issued_by`    FOREIGN KEY (`issued_by`)           REFERENCES `users` (`id`),
  CONSTRAINT `fk_po_cancelled_by` FOREIGN KEY (`cancelled_by`)        REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- An award's purchase order (lots come before purchase_orders in this file).
ALTER TABLE `lots`
  ADD CONSTRAINT `fk_lots_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`) ON DELETE SET NULL;

-- ─── Deliveries ─────────────────────────────────────────────────────────────
CREATE TABLE `deliveries` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `po_id`          INT UNSIGNED NOT NULL,
  `delivered_date` DATE         NOT NULL,
  `received_by`    INT UNSIGNED NOT NULL,
  `status`         ENUM('partial','complete') NOT NULL DEFAULT 'complete',
  `notes`          TEXT         NULL,
  `created_at`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_deliveries_po_id` (`po_id`),
  CONSTRAINT `fk_deliveries_po`   FOREIGN KEY (`po_id`)       REFERENCES `purchase_orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_deliveries_user` FOREIGN KEY (`received_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- How much of each PO line (its awarded lot items) a delivery brought. A PO
-- with lines is delivered once every line is received in full; a PO issued
-- before awards named their items has no lines and is marked by the record.
CREATE TABLE `delivery_items` (
  `delivery_id` INT UNSIGNED  NOT NULL,
  `lot_item_id` INT UNSIGNED  NOT NULL,
  `quantity`    DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (`delivery_id`, `lot_item_id`),
  KEY `idx_delivery_items_lot_item` (`lot_item_id`),
  CONSTRAINT `fk_delivery_items_delivery` FOREIGN KEY (`delivery_id`) REFERENCES `deliveries` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_delivery_items_lot_item` FOREIGN KEY (`lot_item_id`) REFERENCES `lot_items` (`id`)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Supplier invoices / proof of delivery.
CREATE TABLE `delivery_attachments` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `delivery_id`   INT UNSIGNED NOT NULL,
  `filename`      VARCHAR(255) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `mimetype`      VARCHAR(100) NULL,
  `size`          INT UNSIGNED NULL,
  `uploaded_by`   INT UNSIGNED NOT NULL,
  `created_at`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_delivery_attachments_delivery_id` (`delivery_id`),
  CONSTRAINT `fk_delivery_attachments_delivery` FOREIGN KEY (`delivery_id`) REFERENCES `deliveries` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_delivery_attachments_user`     FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Notifications, reminders, password resets ──────────────────────────────
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
  KEY `idx_notifications_user_read` (`user_id`, `is_read`),
  CONSTRAINT `fk_notifications_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `reminders` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title`       VARCHAR(255) NOT NULL,
  `note`        TEXT         NULL,
  `remind_at`   DATETIME     NOT NULL,
  `created_by`  INT UNSIGNED NOT NULL,
  `assigned_to` INT UNSIGNED NOT NULL,
  `pr_id`       INT UNSIGNED NULL,
  `lot_id`      INT UNSIGNED NULL,
  `is_sent`     TINYINT(1)   NOT NULL DEFAULT 0,
  `is_done`     TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_reminders_due` (`is_sent`, `is_done`, `remind_at`),
  CONSTRAINT `fk_reminders_creator`  FOREIGN KEY (`created_by`)  REFERENCES `users` (`id`),
  CONSTRAINT `fk_reminders_assignee` FOREIGN KEY (`assigned_to`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_reminders_pr`       FOREIGN KEY (`pr_id`)       REFERENCES `purchase_requests` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_reminders_lot`      FOREIGN KEY (`lot_id`)      REFERENCES `lots` (`id`)              ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `password_reset_tokens` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    INT UNSIGNED NOT NULL,
  `token_hash` VARCHAR(64)  NOT NULL,
  `expires_at` DATETIME     NOT NULL,
  `used`       TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_prt_token_hash` (`token_hash`),
  KEY `idx_prt_user_id`    (`user_id`),
  CONSTRAINT `fk_prt_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Starting data ──────────────────────────────────────────────────────────

-- Admin account: username `admin`, password `Admin@1234`; put your own email here before importing.
INSERT INTO `users` (`name`, `username`, `email`, `password_hash`, `role`, `is_active`, `is_verified`, `is_approved`) VALUES
  ('System Administrator', 'admin', 'admin@example.com','$2a$10$6M98Da8LCoGWN.6XMDRC8ueqg77kil5.cSOEoQjbDMg8EyF0/RHKu', 'admin', 1, 1, 1);

-- 2026 quarters with their real date ranges; Q3 is the current one.
INSERT INTO `quarters` (`label`, `year`, `start_date`, `end_date`, `is_active`) VALUES
  ('Q1', 2026, '2026-01-01', '2026-03-31', 0),
  ('Q2', 2026, '2026-04-01', '2026-06-30', 0),
  ('Q3', 2026, '2026-07-01', '2026-09-30', 1),
  ('Q4', 2026, '2026-10-01', '2026-12-31', 0);

-- Organization defaults (filled in later under Settings > Organization).
INSERT INTO `org_settings` (`setting_key`, `setting_value`) VALUES
  ('fund_cluster', NULL),
  ('responsibility_center_code', NULL);
