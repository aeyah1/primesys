-- Migration: the Project Procurement Management Plan (PPMP) and e-signatures.
--
-- Each office's Fund Administrator keeps its PPMP: the items the office plans
-- to buy in a fiscal year, in two parts (available at PS-DBM, and other
-- items), with quantity, unit cost, mode of procurement, and the months
-- scheduled. A PPMP is signed by the Fund Administrator on submission and by
-- the approver on approval; a SHA-256 fingerprint of its content is kept, so a
-- change after signing shows. Changing an approved PPMP makes the next
-- version (PPMP No. 2, ...); the approved one stays in force until then.
--
-- users.signature holds each person's signature as a small PNG (data URL);
-- a PPMP keeps a copy of the signatures it was signed with.
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
  `status`             ENUM('draft','submitted','approved','superseded') NOT NULL DEFAULT 'draft',
  `return_reason`      VARCHAR(500) NULL,
  `prepared_by`        INT UNSIGNED NULL,
  `prepared_signature` MEDIUMTEXT NULL,
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
  `sort_order`          INT UNSIGNED  NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_ppmp_items_ppmp` (`ppmp_id`),
  CONSTRAINT `fk_ppmp_items_ppmp` FOREIGN KEY (`ppmp_id`) REFERENCES `ppmps` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Supporting documents attached to a PPMP (the original PPMP file, market scoping checklist, specifications).
CREATE TABLE `ppmp_attachments` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ppmp_id`       INT UNSIGNED NOT NULL,
  `filename`      VARCHAR(255) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `mimetype`      VARCHAR(100) NULL,
  `size`          INT UNSIGNED NULL,
  `uploaded_by`   INT UNSIGNED NULL,
  `created_at`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ppmp_attachments_ppmp` (`ppmp_id`),
  CONSTRAINT `fk_ppmp_attachments_ppmp` FOREIGN KEY (`ppmp_id`)     REFERENCES `ppmps` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ppmp_attachments_user` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
