-- Migration: new-device sign-in by emailed code.
--
-- A browser the account hasn't verified (its first sign-in included) gets a 6-digit code by email before it is let in;
-- a verified browser is remembered here for 30 days. The browser keeps a random device key; only its SHA-256 is stored.
-- Changing or resetting the password forgets every device of the account. Pending codes live in the server's memory.
--
-- Run AFTER add_session_key.sql, BEFORE deploying the server that reads it. Safe to re-run (MariaDB, TiDB).
-- Rollback: DROP TABLE `user_devices`;

CREATE TABLE IF NOT EXISTS `user_devices` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       INT UNSIGNED NOT NULL,
  `device_hash`   CHAR(64)     NOT NULL,
  `label`         VARCHAR(100) NOT NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_used_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `trusted_until` DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_device` (`user_id`, `device_hash`),
  CONSTRAINT `fk_user_devices_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
