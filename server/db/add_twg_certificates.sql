-- Migration: the TWG's certification of a canvass result, as a numbered certificate.
--
-- When the TWG certifies the winners the BAC approved, a Certification (Goods
-- and services) is issued for them: a Cert. No. running per year (suggested
-- as 2026-10-001, editable to follow the campus's paper numbering), the TWG
-- member who checked them, and their signature, signed on the screen or
-- uploaded (unsigned, the printout keeps a blank line to sign by hand). The
-- awards it covers point to it.
--
-- Run AFTER add_ppmp_withdraw.sql.

CREATE TABLE `twg_certificates` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cert_no`      VARCHAR(30)  NOT NULL,
  `pr_id`        INT UNSIGNED NOT NULL,
  `certified_by` INT UNSIGNED NULL,
  `signature`    MEDIUMTEXT   NULL,
  `sign_method`  ENUM('drawn','uploaded') NULL,
  `created_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_twg_cert_no` (`cert_no`),
  KEY `idx_twg_cert_pr` (`pr_id`),
  CONSTRAINT `fk_twg_cert_pr` FOREIGN KEY (`pr_id`)        REFERENCES `purchase_requests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_twg_cert_by` FOREIGN KEY (`certified_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `lots` ADD COLUMN `certificate_id` INT UNSIGNED NULL AFTER `certified_by`;
ALTER TABLE `lots` ADD CONSTRAINT `fk_lots_certificate` FOREIGN KEY (`certificate_id`) REFERENCES `twg_certificates` (`id`) ON DELETE SET NULL;
