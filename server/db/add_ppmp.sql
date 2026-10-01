-- Migration: the Project Procurement Management Plan (PPMP), as uploaded from the office's original.
--
-- The PPMP is made and signed outside the system. Its Fund Administrator
-- uploads the original: the data file (Excel, Word, or CSV) the items are
-- read from, and the signed copy (a scan or photo). Rows the system misread
-- can be corrected before submitting; each correction is kept with what the
-- file said. The approver checks the system copy against the signed original
-- and signs it as verified; only then can purchase requests be based on it.
-- A SHA-256 fingerprint covers the items and both files. An amended PPMP is
-- uploaded as the next version (PPMP No. 2, ...), which supersedes the
-- approved one once verified.
--
-- users.signature holds a signer's signature as a small PNG (data URL).
--
-- Run AFTER add_fund_administrator.sql.
-- Rollback:
--   DROP TABLE `ppmp_attachments`;
--   DROP TABLE `ppmp_items`;
--   DROP TABLE `ppmps`;
--   ALTER TABLE `users` DROP COLUMN `signature`;

ALTER TABLE `users` ADD COLUMN `signature` MEDIUMTEXT NULL;

CREATE TABLE `ppmps` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `department_id`      INT UNSIGNED NOT NULL,
  `fiscal_year`        SMALLINT UNSIGNED NOT NULL,
  `version_no`         INT UNSIGNED NOT NULL DEFAULT 1,
  `kind`               ENUM('indicative','final') NOT NULL DEFAULT 'final',
  `fund_source`        ENUM('STF','GAA','IGP') NOT NULL DEFAULT 'STF',
  `status`             ENUM('draft','submitted','approved','superseded') NOT NULL DEFAULT 'submitted',
  `return_reason`      VARCHAR(500) NULL,
  `file_office`        VARCHAR(200) NULL,
  `skipped_rows`       TEXT NULL,
  `prepared_by`        INT UNSIGNED NULL,
  `submitted_at`       DATETIME NULL,
  `approved_by`        INT UNSIGNED NULL,
  `approved_signature` MEDIUMTEXT NULL,
  `approved_at`        DATETIME NULL,
  `content_hash`       CHAR(64) NULL,
  `created_at`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ppmp_version` (`department_id`, `fiscal_year`, `version_no`),
  CONSTRAINT `fk_ppmp_department`  FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`),
  CONSTRAINT `fk_ppmp_prepared_by` FOREIGN KEY (`prepared_by`)   REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ppmp_approved_by` FOREIGN KEY (`approved_by`)   REFERENCES `users` (`id`) ON DELETE SET NULL
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
  `remarks`             VARCHAR(500)  NULL,
  `file_row`            INT UNSIGNED  NULL,
  `corrected`           TINYINT(1)    NOT NULL DEFAULT 0,
  `as_read`             TEXT          NULL,
  `sort_order`          INT UNSIGNED  NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_ppmp_items_ppmp` (`ppmp_id`),
  CONSTRAINT `fk_ppmp_items_ppmp` FOREIGN KEY (`ppmp_id`) REFERENCES `ppmps` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The two original files of a PPMP: the data file its items were read from, and the signed copy.
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
