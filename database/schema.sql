-- PRimeSys: Web-Based Procurement Monitoring System
-- Complete database for a FRESH local install (XAMPP / MariaDB 10.4+)
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

CREATE DATABASE IF NOT EXISTS `primesys` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `primesys`;

SET NAMES utf8mb4;

-- Departments
-- The offices that file purchase requests. Each carries the head who signs
-- "Requested by" on the printed form; a department with no head_name still
-- works, the form just prints a blank line to sign by hand.
CREATE TABLE `departments` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`             VARCHAR(20)  NOT NULL,   -- printed in the form's Office/Section cell
  `name`             VARCHAR(150) NOT NULL,
  `head_name`        VARCHAR(150) NULL,
  `head_designation` VARCHAR(150) NULL,
  `is_active`        TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_department_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Users
-- Public sign-up always creates a requestor (shown as Fund Administrator, one per office), waiting for an admin to approve it; admins assign every other role
-- (bac: a member of the Bids and Awards Committee, who approves awards).
CREATE TABLE `users` (
  `id`                         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`                       VARCHAR(100) NOT NULL,
  -- Job title as it should print on the PR form, e.g. "Department Chair, DCS".
  `designation`                VARCHAR(150) NULL,
  -- The office this person encodes for; pre-fills the PR form.
  `department_id`              INT UNSIGNED NULL,
  `username`                   VARCHAR(50)  NULL,
  `email`                      VARCHAR(150) NOT NULL,
  `password_hash`              VARCHAR(255) NOT NULL,
  `role`                       ENUM('admin','procurement','requestor','supply','twg','bac') NOT NULL DEFAULT 'requestor',
  `is_active`                  TINYINT(1)   NOT NULL DEFAULT 1,
  -- 1 once an admin approved the account; a waiting account can't sign in.
  `is_verified`                TINYINT(1)   NOT NULL DEFAULT 0,
  -- Sign-in tokens carry this number; changing or resetting the password
  -- raises it, so every token issued before stops working.
  `token_version`              INT UNSIGNED NOT NULL DEFAULT 0,
  `fund_cluster`               VARCHAR(100) NULL,
  `responsibility_center_code` VARCHAR(100) NULL,
  -- A TWG member's own saved signature (PNG data URL), filled in when they certify; only they read it.
  `saved_signature`            MEDIUMTEXT   NULL,
  `saved_sign_method`          ENUM('drawn','uploaded') NULL,
  `created_at`                 TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                 TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email`    (`email`),
  UNIQUE KEY `uq_username` (`username`),
  KEY `idx_users_department` (`department_id`),
  CONSTRAINT `fk_users_department` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Quarters
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

-- Organization settings
CREATE TABLE `org_settings` (
  `setting_key`   VARCHAR(100) NOT NULL,
  `setting_value` TEXT         NULL,
  `updated_at`    DATETIME     NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Saved signatures of the officials named in the settings, kept under each one's name (utils/orgSignatures.js).
CREATE TABLE `org_signatures` (
  `name_key`    VARCHAR(150) NOT NULL,   -- the signatory's name in lower case, spaces collapsed
  `name`        VARCHAR(150) NOT NULL,
  `image`       MEDIUMTEXT   NOT NULL,   -- PNG data URL
  `sign_method` ENUM('drawn','uploaded') NOT NULL,
  `saved_by`    INT UNSIGNED NULL,
  `updated_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`name_key`),
  CONSTRAINT `fk_org_signatures_by` FOREIGN KEY (`saved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Purchase requests
-- Status flow and who may change it: server/utils/prWorkflow.js.
-- A deleted PR is kept (deleted_at / deleted_by) and listed under Archive.
-- pr_number holds a temporary reference (REQ-000123) until Procurement assigns
-- the PR number when the canvass starts (server/utils/prNumber.js).
CREATE TABLE `purchase_requests` (
  `id`                         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pr_number`                  VARCHAR(50)  NOT NULL,
  `quarter_id`                 INT UNSIGNED NULL,
  `title`                      VARCHAR(200) NULL,
  -- The code of the fund this request is drawn on, frozen when it is filed.
  `fund_cluster`               VARCHAR(50)  NULL,
  -- Which of the three funds that code came from (org_settings.fund_code_*).
  `fund_source`                ENUM('STF','GAA','IGP') NOT NULL DEFAULT 'STF',
  -- How this is procured (server/utils/procurementModes.js). Set by
  -- Procurement, not asked of the person filing the request.
  `mode_of_procurement`        VARCHAR(60)  NULL,
  -- Submitted by Procurement (the BAC Secretariat) for the BAC to review the
  -- canvass result; why the BAC last returned it to Procurement.
  `bac_submitted_at`           DATETIME     NULL,
  `bac_submitted_by`           INT UNSIGNED NULL,
  `bac_return_reason`          VARCHAR(500) NULL,
  `responsibility_center_code` VARCHAR(50)  NULL,
  `department`                 VARCHAR(150) NULL,   -- as printed in Office/Section
  `department_id`              INT UNSIGNED NULL,
  `purpose_type`               ENUM('personal','event','office','project') NOT NULL DEFAULT 'personal',
  `purpose`                    TEXT         NULL,
  `date_needed`                DATE         NULL,
  `recommended_by`             VARCHAR(150) NULL,
  `event_name`                 VARCHAR(200) NULL,
  `event_date`                 DATE         NULL,
  `project_name`               VARCHAR(200) NULL,
  `category`                   ENUM('hardware','office_supplies','lab_educational','furniture','food_catering','event_supplies') NOT NULL DEFAULT 'office_supplies',
  -- bidding is the canvass (done outside the system); bac_review and twg_certification follow it; re_pr waits for
  -- the BAC to send a Re-PR to the End User (appended last, as TiDB only appends ENUM members).
  `status`                     ENUM('draft','submitted','twg_review','revision_requested','rejected','bidding','bac_review','twg_certification','for_po','completed','cancelled','re_pr') NOT NULL DEFAULT 'draft',
  `notes`                      TEXT         NULL,
  `created_by`                 INT UNSIGNED NOT NULL,
  -- Who requested it, as the form's "Requested by" prints them: typed by the
  -- Fund Administrator who files it, the office head when none is typed (frozen,
  -- so a later change of head leaves filed PRs alone). Their signature, drawn
  -- on the screen or uploaded, prints on the signature line (PNG data URL).
  `requested_by_name`          VARCHAR(150) NULL,
  `requested_by_designation`   VARCHAR(150) NULL,
  `requested_by_signature`     MEDIUMTEXT   NULL,
  `requested_by_sign_method`   ENUM('drawn','uploaded') NULL,
  `requested_by_signed_at`     DATETIME     NULL,
  `twg_reviewed_by`            INT UNSIGNED NULL,
  `twg_reviewed_at`            TIMESTAMP    NULL DEFAULT NULL,
  `twg_comment`                TEXT         NULL,
  -- The TWG's second review, after the BAC's: its certification, or why it returned the request to the BAC or ordered a re-canvass.
  `twg_certified_by`           INT UNSIGNED NULL,
  `twg_certified_at`           DATETIME     NULL,
  `twg_certification_note`     TEXT         NULL,
  `certification_return_reason` VARCHAR(500) NULL,
  `recanvass_reason`           TEXT         NULL,
  `recanvass_count`            TINYINT UNSIGNED NOT NULL DEFAULT 0,   -- times the TWG ordered a re-canvass
  -- A Re-PR: why the TWG sent the request back to its End User (the kind, raise_budget / change_specs / revise_specs,
  -- and the details), the BAC's note when it sent it on, and how many times it went back.
  `re_pr_type`                 VARCHAR(30)  NULL,
  `re_pr_reason`               TEXT         NULL,
  `re_pr_note`                 TEXT         NULL,
  `re_pr_count`                TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `deleted_at`                 TIMESTAMP    NULL DEFAULT NULL,
  `deleted_by`                 INT UNSIGNED NULL,
  `delete_reason`              VARCHAR(500) NULL,   -- why it was deleted (none when its filer deleted their own draft)
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
  KEY `idx_pr_department_id`    (`department_id`),
  CONSTRAINT `fk_pr_created_by`   FOREIGN KEY (`created_by`)      REFERENCES `users` (`id`),
  CONSTRAINT `fk_pr_department`   FOREIGN KEY (`department_id`)   REFERENCES `departments` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pr_quarter`      FOREIGN KEY (`quarter_id`)      REFERENCES `quarters` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pr_twg_reviewer` FOREIGN KEY (`twg_reviewed_by`) REFERENCES `users` (`id`)    ON DELETE SET NULL,
  CONSTRAINT `fk_pr_deleted_by`   FOREIGN KEY (`deleted_by`)      REFERENCES `users` (`id`)    ON DELETE SET NULL,
  CONSTRAINT `fk_pr_bac_submitted_by` FOREIGN KEY (`bac_submitted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pr_twg_certified_by` FOREIGN KEY (`twg_certified_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `pr_items` (
  `id`             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `pr_id`          INT UNSIGNED  NOT NULL,
  -- The PPMP line this item is drawn from (server/utils/ppmpUse.js); its foreign key follows ppmp_items below.
  `ppmp_item_id`   INT UNSIGNED  NULL,
  -- Stock/Property No. on the PR form; assigned by the Supply Office, often blank.
  `stock_property_no` VARCHAR(50) NULL,
  `group_label`    VARCHAR(255)  NULL,
  -- What kind of thing this is. The request's own category is derived from its
  -- items (server/utils/categories.js), and that is what routes it to the TWG.
  `category`       ENUM('hardware','office_supplies','lab_educational','furniture','food_catering','event_supplies') NULL,
  `item_name`      VARCHAR(500)  NOT NULL,
  `quantity`       DECIMAL(10,2) NOT NULL DEFAULT 1,
  `unit`           VARCHAR(50)   NULL,
  `estimated_cost` DECIMAL(15,2) NULL,
  `notes`          TEXT          NULL,
  -- Dropped from the procurement (e.g. no supplier could offer it), with why.
  `dropped_at`     DATETIME      NULL,
  `dropped_by`     INT UNSIGNED  NULL,
  `drop_reason`    VARCHAR(500)  NULL,
  -- The item whose undelivered quantity this one is (a closed PO's balance, back to canvass).
  `balance_of`     INT UNSIGNED  NULL,
  -- The bidder the BAC picks as this item's winner (FK added after canvass_bidders, below), and why when not the lowest.
  `winner_bidder_id` INT UNSIGNED NULL,
  `winner_reason`  VARCHAR(500)  NULL,
  `created_at`     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pr_items_pr_id` (`pr_id`),
  KEY `idx_pr_items_category` (`category`),
  KEY `idx_pr_items_ppmp_item` (`ppmp_item_id`),
  CONSTRAINT `fk_pr_items_pr`         FOREIGN KEY (`pr_id`)      REFERENCES `purchase_requests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pr_items_dropped_by` FOREIGN KEY (`dropped_by`) REFERENCES `users` (`id`)             ON DELETE SET NULL,
  CONSTRAINT `fk_pr_items_balance_of` FOREIGN KEY (`balance_of`) REFERENCES `pr_items` (`id`)          ON DELETE SET NULL
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

-- TWG review areas
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

-- Lots & awards
-- A lot records the supplier awarded some of a PR's items (lot_items with
-- pr_item_id with the winning unit price; different items may go to different
-- suppliers), as Procurement records it from the canvass done outside the
-- system, the BAC Resolution that approved it (resolution_id), the TWG's
-- certification, and the purchase order issued for it (po_id, one supplier's POs).
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
  `resolution_id`       INT UNSIGNED  NULL,   -- FK added after bac_resolutions, below
  -- Certified by the TWG after the BAC's review; only a certified award gets a purchase order.
  `certified_at`        DATETIME      NULL,
  `certified_by`        INT UNSIGNED  NULL,
  `certificate_id`      INT UNSIGNED  NULL,   -- the TWG certificate; FK added after twg_certificates, below
  `po_id`              INT UNSIGNED  NULL,   -- FK added after purchase_orders, below
  `created_by`          INT UNSIGNED  NOT NULL,
  `created_at`          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lots_pr_id`  (`purchase_request_id`),
  KEY `idx_lots_status` (`status`),
  KEY `idx_lots_po_id` (`po_id`),
  KEY `idx_lots_resolution_id` (`resolution_id`),
  CONSTRAINT `fk_lots_pr`        FOREIGN KEY (`purchase_request_id`) REFERENCES `purchase_requests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lots_user`      FOREIGN KEY (`created_by`)          REFERENCES `users` (`id`),
  CONSTRAINT `fk_lots_certified_by` FOREIGN KEY (`certified_by`)    REFERENCES `users` (`id`) ON DELETE SET NULL
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
  `short_quantity` DECIMAL(10,2) NOT NULL DEFAULT 0,   -- never delivered: the PO's balance was closed
  `created_at`     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lot_items_lot_id` (`lot_id`),
  KEY `idx_lot_items_pr_item` (`pr_item_id`),
  CONSTRAINT `fk_lot_items_lot`     FOREIGN KEY (`lot_id`)     REFERENCES `lots` (`id`)     ON DELETE CASCADE,
  CONSTRAINT `fk_lot_items_pr_item` FOREIGN KEY (`pr_item_id`) REFERENCES `pr_items` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The supplier profiles Procurement and Admin keep. A quotation the BAC enters
-- is linked to the profile of the same name (canvass_bidders.supplier_id), so a
-- profile shows every request it quoted on, its awards and its DQs.
CREATE TABLE `suppliers` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(200) NOT NULL,
  `name_key`       VARCHAR(200) NOT NULL,   -- the name in lower case with single spaces
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

-- BAC resolutions
-- The canvass bids the BAC enters from the canvasser's returned RFQs, one
-- quotation at a time: each bidder (a supplier, by name, with its RFQ No. and
-- its RFQ file) and its unit price for each PR item it offered. The TWG marks
-- each bid compliant or not, with the offered specification and the reason
-- (its certificate lists them), and the BAC picks each lot's winner
-- (pr_items.winner_bidder_id, on each item of the lot) and awards.
CREATE TABLE `canvass_bidders` (
  `id`         INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  `pr_id`      INT UNSIGNED      NOT NULL,
  `name`       VARCHAR(200)      NOT NULL,
  `rfq_no`     VARCHAR(50)       NULL,       -- the number on the supplier's returned RFQ
  `attachment_id` INT UNSIGNED   NULL,       -- the supplier's returned RFQ, attached to the PR
  `dq_remarks` VARCHAR(500)      NULL,       -- the TWG's remark on a supplier it found DQ
  `supplier_id` INT UNSIGNED     NULL,       -- the supplier's profile, by name
  `position`   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `created_by` INT UNSIGNED      NULL,
  `created_at` TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_canvass_bidders_pr` (`pr_id`),
  KEY `idx_canvass_bidders_supplier` (`supplier_id`),
  CONSTRAINT `fk_canvass_bidders_pr` FOREIGN KEY (`pr_id`)      REFERENCES `purchase_requests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_canvass_bidders_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_canvass_bidders_file` FOREIGN KEY (`attachment_id`) REFERENCES `pr_attachments` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_canvass_bidders_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `canvass_bids` (
  `id`         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `bidder_id`  INT UNSIGNED  NOT NULL,
  `pr_item_id` INT UNSIGNED  NOT NULL,
  `unit_price` DECIMAL(15,2) NOT NULL,
  -- The TWG's evaluation: compliant (NULL until checked), what was offered, and why not compliant.
  `compliant`      TINYINT(1)    NULL,
  `offered_spec`   VARCHAR(1000) NULL,
  `remarks`        VARCHAR(500)  NULL,
  `certificate_id` INT UNSIGNED  NULL,   -- FK added after twg_certificates, below
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_canvass_bid` (`bidder_id`, `pr_item_id`),
  KEY `idx_canvass_bids_item` (`pr_item_id`),
  CONSTRAINT `fk_canvass_bids_bidder` FOREIGN KEY (`bidder_id`)  REFERENCES `canvass_bidders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_canvass_bids_item`   FOREIGN KEY (`pr_item_id`) REFERENCES `pr_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `pr_items`
  ADD CONSTRAINT `fk_pr_items_winner` FOREIGN KEY (`winner_bidder_id`) REFERENCES `canvass_bidders` (`id`) ON DELETE SET NULL;

-- One per approval of a PR's recommended awards, numbered per year (2026-001).
-- Printed as the BAC Resolution; each supplier's awards in it as a Notice of Award.
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
  ADD CONSTRAINT `fk_lots_resolution` FOREIGN KEY (`resolution_id`) REFERENCES `bac_resolutions` (`id`) ON DELETE SET NULL;

-- One per TWG certification of a PR's bids (the compliance of every offer),
-- numbered per year (suggested 2026-10-001, editable). Printed as the Certification (Goods and services).
CREATE TABLE `twg_certificates` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cert_no`      VARCHAR(30)  NOT NULL,
  `pr_id`        INT UNSIGNED NOT NULL,
  -- review: the TWG checked the request's market price and specifications (issued on approval); bids: the canvass bids.
  `kind`         ENUM('review','bids') NOT NULL DEFAULT 'bids',
  `certified_by` INT UNSIGNED NULL,
  `signature`    MEDIUMTEXT   NULL,       -- PNG data URL, signed on the screen or uploaded
  `sign_method`  ENUM('drawn','uploaded') NULL,
  `created_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_twg_cert_no` (`cert_no`),
  KEY `idx_twg_cert_pr` (`pr_id`),
  CONSTRAINT `fk_twg_cert_pr` FOREIGN KEY (`pr_id`)        REFERENCES `purchase_requests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_twg_cert_by` FOREIGN KEY (`certified_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `lots`
  ADD CONSTRAINT `fk_lots_certificate` FOREIGN KEY (`certificate_id`) REFERENCES `twg_certificates` (`id`) ON DELETE SET NULL;
ALTER TABLE `canvass_bids`
  ADD CONSTRAINT `fk_canvass_bids_certificate` FOREIGN KEY (`certificate_id`) REFERENCES `twg_certificates` (`id`) ON DELETE SET NULL;

-- Purchase orders
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
  -- The balance closed on a partly delivered PO: who, when, why, the value not
  -- delivered (not paid), and the late-delivery penalty worked out then.
  `closed_at`              DATETIME      NULL,
  `closed_by`              INT UNSIGNED  NULL,
  `close_reason`           VARCHAR(1000) NULL,
  `short_amount`           DECIMAL(15,2) NULL,
  `penalty_amount`         DECIMAL(15,2) NULL,
  `issued_by`              INT UNSIGNED  NOT NULL,
  `created_at`             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_po_number`               (`po_number`),
  KEY `idx_po_purchase_request_id`        (`purchase_request_id`),
  KEY `idx_delivery_status`               (`delivery_status`),
  CONSTRAINT `fk_po_pr`           FOREIGN KEY (`purchase_request_id`) REFERENCES `purchase_requests` (`id`),
  CONSTRAINT `fk_po_issued_by`    FOREIGN KEY (`issued_by`)           REFERENCES `users` (`id`),
  CONSTRAINT `fk_po_cancelled_by` FOREIGN KEY (`cancelled_by`)        REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_po_closed_by`    FOREIGN KEY (`closed_by`)           REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- An award's purchase order (lots come before purchase_orders in this file).
ALTER TABLE `lots`
  ADD CONSTRAINT `fk_lots_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`) ON DELETE SET NULL;

-- Deliveries
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

-- Notifications, reminders, password resets
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

-- PPMP: each office's plan for a fiscal year, uploaded as its softcopy; in effect once complete (server/db/add_ppmp.sql).
CREATE TABLE `ppmps` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `department_id`      INT UNSIGNED NOT NULL,
  `fiscal_year`        SMALLINT UNSIGNED NOT NULL,
  `version_no`         INT UNSIGNED NOT NULL DEFAULT 1,
  -- The version this one was edited from in PRimeSys (its uploaded file stays with that one); NULL for an uploaded file.
  `edited_from`        INT UNSIGNED NULL,
  `kind`               ENUM('indicative','final') NOT NULL DEFAULT 'final',
  `fund_source`        ENUM('STF','GAA','IGP') NOT NULL DEFAULT 'STF',
  -- draft: kept but not in effect (see problems); approved: signed and complete, in effect; superseded: a later version took effect;
  -- withdrawn: an admin took it back as a mistake (withdrawn_*), the version it replaced in effect again.
  `status`             ENUM('draft','approved','superseded','withdrawn') NOT NULL DEFAULT 'draft',
  -- Why it is not in effect: what is unsigned or missing (JSON list); null once it is.
  `problems`           TEXT NULL,
  -- PPMPs uploaded before 2026-10 only: how the signed copy was signed, digital (checked) or paper (declared by the uploader).
  `signed_kind`        ENUM('digital','paper') NULL,
  -- PPMPs uploaded before 2026-10 only: the digital signatures on the signed copy, with their checks (JSON).
  `signatures`         TEXT NULL,
  -- The file's signature block: who prepared, approved, or reviewed it (JSON).
  `signatories`        TEXT NULL,
  `file_office`        VARCHAR(200) NULL,
  `skipped_rows`       TEXT NULL,
  `uploaded_by`        INT UNSIGNED NULL,
  `uploaded_at`        DATETIME NULL,
  `effective_at`       DATETIME NULL,
  `content_hash`       CHAR(64) NULL,
  `created_at`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `withdrawn_at`       DATETIME NULL,
  `withdrawn_by`       INT UNSIGNED NULL,
  `withdraw_reason`    VARCHAR(500) NULL,
  -- The Fund Administrator's request that an admin remove it (withdraw it), while it waits.
  `removal_requested_by` INT UNSIGNED NULL,
  `removal_requested_at` DATETIME NULL,
  `removal_reason`     VARCHAR(500) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ppmp_version` (`department_id`, `fiscal_year`, `version_no`),
  CONSTRAINT `fk_ppmp_department`  FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`),
  CONSTRAINT `fk_ppmp_uploaded_by` FOREIGN KEY (`uploaded_by`)   REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ppmp_withdrawn_by` FOREIGN KEY (`withdrawn_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ppmp_items` (
  `id`                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ppmp_id`             INT UNSIGNED NOT NULL,
  `part`                ENUM('ps','other') NOT NULL DEFAULT 'other',
  `category`            VARCHAR(100)  NULL,
  `code`                VARCHAR(50)   NULL,
  `description`         VARCHAR(500)  NOT NULL,
  `unit`                VARCHAR(50)   NOT NULL,
  `quantity`            DECIMAL(10,2) NOT NULL,
  `unit_cost`           DECIMAL(15,2) NOT NULL,
  `mode_of_procurement` VARCHAR(50)   NULL,
  `months`              VARCHAR(40)   NULL,
  -- Each quarter's quantity from the file's month columns (Jan to Mar is Q1); null when they don't add up to the quantity.
  `qty_q1`              DECIMAL(10,2) NULL,
  `qty_q2`              DECIMAL(10,2) NULL,
  `qty_q3`              DECIMAL(10,2) NULL,
  `qty_q4`              DECIMAL(10,2) NULL,
  `remarks`             VARCHAR(500)  NULL,
  `file_row`            INT UNSIGNED  NULL,
  `sort_order`          INT UNSIGNED  NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_ppmp_items_ppmp` (`ppmp_id`),
  CONSTRAINT `fk_ppmp_items_ppmp` FOREIGN KEY (`ppmp_id`) REFERENCES `ppmps` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `pr_items` ADD CONSTRAINT `fk_pr_items_ppmp_item` FOREIGN KEY (`ppmp_item_id`) REFERENCES `ppmp_items` (`id`);

-- The original files of a PPMP: the softcopy its items were read from (and, before 2026-10, the signed copy).
CREATE TABLE `ppmp_attachments` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ppmp_id`       INT UNSIGNED NOT NULL,
  `role`          ENUM('data','signed') NOT NULL,
  `filename`      VARCHAR(255) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `mimetype`      VARCHAR(100) NULL,
  `size`          INT UNSIGNED NULL,
  `sha256`        CHAR(64)     NOT NULL,
  `uploaded_by`   INT UNSIGNED NULL,
  `created_at`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ppmp_attachments_ppmp` (`ppmp_id`),
  CONSTRAINT `fk_ppmp_attachments_ppmp` FOREIGN KEY (`ppmp_id`)     REFERENCES `ppmps` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ppmp_attachments_user` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Starting data

-- Admin account: username `admin`, password `Admin@1234`; put your own email here before importing.
INSERT INTO `users` (`name`, `username`, `email`, `password_hash`, `role`, `is_active`, `is_verified`) VALUES
  ('System Administrator', 'admin', 'admin@example.com','$2a$10$6M98Da8LCoGWN.6XMDRC8ueqg77kil5.cSOEoQjbDMg8EyF0/RHKu', 'admin', 1, 1);

-- The one department supplied so far; admins add the rest with their heads
-- under Settings > Organization.
INSERT INTO `departments` (`code`, `name`, `head_name`, `head_designation`) VALUES
  ('DCS', 'Department of Computer Studies', NULL, 'Department Chair, DCS');

-- 2026 quarters with their real date ranges; Q3 is the current one.
INSERT INTO `quarters` (`label`, `year`, `start_date`, `end_date`, `is_active`) VALUES
  ('Q1', 2026, '2026-01-01', '2026-03-31', 0),
  ('Q2', 2026, '2026-04-01', '2026-06-30', 0),
  ('Q3', 2026, '2026-07-01', '2026-09-30', 1),
  ('Q4', 2026, '2026-10-01', '2026-12-31', 0);

-- Organization defaults (filled in later under Settings > Organization).
-- The four signatory pairs and the entity name print on the PR form
-- (Appendix 60); pr_number_prefix is the "CSO" in "CSO 2026-001".
INSERT INTO `org_settings` (`setting_key`, `setting_value`) VALUES
  ('fund_cluster', NULL),
  ('responsibility_center_code', NULL),
  ('entity_name',                  'NEMSU - Cantilan Campus'),
  ('pr_number_prefix',             'CSO'),
  ('approved_by_name',             NULL),
  ('approved_by_designation',      'Campus Director'),
  ('allotment_by_name',            NULL),
  ('allotment_by_designation',     'AO IV/Budget Officer II'),
  ('app_certified_by_name',        NULL),
  ('app_certified_by_designation', 'BAC Secretariat'),
  -- Certifies Funds Available on the Purchase Order (COA Appendix 61).
  ('chief_accountant_name',        NULL),
  ('chief_accountant_designation', 'Chief Accountant'),
  -- The Request for Quotation's letterhead.
  ('entity_full_name',              'NORTH EASTERN MINDANAO STATE UNIVERSITY'),
  ('entity_campus',                 'Cantilan Campus'),
  ('entity_address',                'Cantilan Surigao del Sur'),
  ('entity_telefax',                '086-212-5132'),
  ('entity_website',                'www.nemsu.edu.ph'),
  -- Source of fund: the code printed for each of the three choices.
  ('fund_code_stf',                 '05-206441'),
  ('fund_code_gaa',                 '01-101101'),
  ('fund_code_igp',                 '05-206441-IGP'),
  -- At or below this amount the Campus Director approves; above it the
  -- University President does.
  ('approver_threshold',            '50000'),
  ('approved_above_name',           NULL),
  ('approved_above_designation',    'University President'),
  -- Request for Quotation signatories.
  ('bac_vice_chairman_name',        NULL),
  ('bac_vice_chairman_designation', 'BAC Vice Chairman'),
  ('canvasser_name',                NULL),
  ('canvasser_designation',         'Canvasser'),
  -- The committee as it prints on the BAC Resolution (bac_members: one name per line).
  ('bac_chairman_name',             NULL),
  ('bac_chairman_designation',      'BAC Chairman'),
  ('bac_members',                   NULL);
