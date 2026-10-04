-- Migration: the Project Procurement Management Plan (PPMP), as uploaded from the office's signed original.
--
-- The PPMP is made and signed outside the system. Its Fund Administrator
-- uploads the data file (Excel, Word, or CSV) its items are read from, and the
-- signed copy: a PDF signed digitally (PNPKI, Adobe), which the system checks,
-- or a scan of the copy signed on paper, which the Fund Administrator declares
-- signed. Items are taken from the file as they are; nothing is edited in the
-- system. A PPMP that is signed and complete is in effect at once (approved),
-- and purchase requests draw on it; one that isn't is kept as a draft with what
-- is missing, and requests can't use it. No one else approves it. An amended
-- PPMP is uploaded as the next version (PPMP No. 2, ...) and supersedes the one
-- in effect once it is itself signed and complete. A SHA-256 fingerprint covers
-- the items and both files.
--
-- Run AFTER add_fund_administrator.sql.
-- Rollback:
--   DROP TABLE `ppmp_attachments`;
--   DROP TABLE `ppmp_items`;
--   DROP TABLE `ppmps`;

CREATE TABLE `ppmps` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `department_id`      INT UNSIGNED NOT NULL,
  `fiscal_year`        SMALLINT UNSIGNED NOT NULL,
  `version_no`         INT UNSIGNED NOT NULL DEFAULT 1,
  `kind`               ENUM('indicative','final') NOT NULL DEFAULT 'final',
  `fund_source`        ENUM('STF','GAA','IGP') NOT NULL DEFAULT 'STF',
  -- draft: kept but not in effect (see problems); approved: signed and complete, in effect; superseded: a later version took effect.
  `status`             ENUM('draft','approved','superseded') NOT NULL DEFAULT 'draft',
  -- Why it is not in effect: what is unsigned or missing (JSON list); null once it is.
  `problems`           TEXT NULL,
  -- How the signed copy is signed: digital (checked by the system) or paper (declared by the uploader).
  `signed_kind`        ENUM('digital','paper') NULL,
  -- The digital signatures on the signed copy, with their checks (JSON).
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
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ppmp_version` (`department_id`, `fiscal_year`, `version_no`),
  CONSTRAINT `fk_ppmp_department`  FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`),
  CONSTRAINT `fk_ppmp_uploaded_by` FOREIGN KEY (`uploaded_by`)   REFERENCES `users` (`id`) ON DELETE SET NULL
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
