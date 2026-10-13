-- Migration: the audit log the admin reads (Audit Log page).
--
-- One row per change anyone makes (every create, edit, delete, submit, review, award) and per sign-in event (sign-ins,
-- sign-outs, failed attempts, lockouts), written by utils/audit.js. It keeps who (name and role as they were), what,
-- which item, when, the result, and the browser and address; never passwords, codes, or what a form held. No foreign
-- key on user_id: a deleted account's history stays. Rows older than a year are removed each night.
--
-- Run AFTER add_skip_login_code.sql, BEFORE deploying the server that writes it. Safe to re-run (MariaDB, TiDB).
-- Rollback: DROP TABLE `audit_logs`;

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id`          BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `created_at`  DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `user_id`     INT UNSIGNED      NULL,
  `user_name`   VARCHAR(100)      NULL,
  `user_role`   VARCHAR(20)       NULL,
  `action`      VARCHAR(80)       NOT NULL,
  `category`    VARCHAR(20)       NOT NULL,
  `summary`     VARCHAR(200)      NOT NULL,
  `target_type` VARCHAR(20)       NULL,
  `target_id`   INT UNSIGNED      NULL,
  `outcome`     VARCHAR(10)       NOT NULL,
  `status`      SMALLINT UNSIGNED NULL,
  `detail`      VARCHAR(255)      NULL,
  `ip`          VARCHAR(45)       NULL,
  `device`      VARCHAR(100)      NULL,
  PRIMARY KEY (`id`),
  KEY `idx_audit_created`  (`created_at`),
  KEY `idx_audit_user`     (`user_id`, `created_at`),
  KEY `idx_audit_category` (`category`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
