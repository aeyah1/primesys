-- Soft delete for purchase requests.
--
-- A deleted PR is kept, with its items, attachments, and audit log, and listed
-- under Archive > Deleted instead of being erased. Existing rows stay
-- undeleted (NULL). Run BEFORE starting the server code that reads these
-- columns. ADD ... IF NOT EXISTS works on MariaDB (XAMPP); safe to re-run.
ALTER TABLE `purchase_requests`
  ADD COLUMN IF NOT EXISTS `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `deleted_by` INT UNSIGNED NULL DEFAULT NULL,
  ADD INDEX IF NOT EXISTS `idx_pr_deleted_at` (`deleted_at`),
  ADD CONSTRAINT `fk_pr_deleted_by` FOREIGN KEY IF NOT EXISTS (`deleted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;
