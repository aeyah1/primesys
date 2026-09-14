-- Cancelling a purchase order (e.g. the supplier backs out before delivery).
--
-- The PO is kept, marked cancelled with who / when / why, and the PR can be
-- re-awarded and given a new PO. The unused po_status values
-- 'pending_approval' / 'approved' become 'active' / 'cancelled', and
-- "one PO per PR" becomes "one ACTIVE PO per PR".
-- Run BEFORE starting the server code that reads these columns.
-- ADD / DROP ... IF [NOT] EXISTS works on MariaDB (XAMPP); safe to re-run.

-- 1. po_status: widen, move existing rows to 'active', then narrow.
ALTER TABLE `purchase_orders`
  MODIFY COLUMN `po_status` ENUM('pending_approval','approved','active','cancelled') NOT NULL DEFAULT 'active';
UPDATE `purchase_orders` SET `po_status` = 'active' WHERE `po_status` IN ('pending_approval','approved');
ALTER TABLE `purchase_orders`
  MODIFY COLUMN `po_status` ENUM('active','cancelled') NOT NULL DEFAULT 'active';

-- 2. Who cancelled, when, and why.
ALTER TABLE `purchase_orders`
  ADD COLUMN IF NOT EXISTS `cancelled_at`  TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `cancelled_by`  INT UNSIGNED NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `cancel_reason` TEXT NULL,
  ADD CONSTRAINT `fk_po_cancelled_by` FOREIGN KEY IF NOT EXISTS (`cancelled_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;

-- 3. One active PO per PR. The foreign key on purchase_request_id needs an
--    index of its own before the old one-PO-per-PR unique index can go.
ALTER TABLE `purchase_orders`
  ADD INDEX IF NOT EXISTS `idx_po_purchase_request_id` (`purchase_request_id`);
ALTER TABLE `purchase_orders`
  ADD COLUMN IF NOT EXISTS `active_pr_id` INT UNSIGNED
    AS (IF(`po_status` = 'active', `purchase_request_id`, NULL)) STORED,
  ADD UNIQUE INDEX IF NOT EXISTS `uq_active_po_per_pr` (`active_pr_id`);
ALTER TABLE `purchase_orders` DROP INDEX IF EXISTS `uq_pr_po`;
