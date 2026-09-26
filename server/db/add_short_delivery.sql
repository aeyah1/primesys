-- Migration: closing a purchase order that was only partly delivered.
--
-- When a supplier can't deliver the rest, Procurement closes the PO's balance:
-- what arrived is kept and paid for; each line's undelivered quantity is kept
-- on the line (lot_items.short_quantity) and its value on the PO
-- (short_amount), with the late-delivery penalty worked out at that moment.
-- The undelivered quantity of an item goes back to canvass as a balance item
-- (pr_items.balance_of names the item it came from).
--
-- Run AFTER add_award_notices.sql.
-- Rollback:
--   ALTER TABLE `purchase_orders` DROP FOREIGN KEY `fk_po_closed_by`;
--   ALTER TABLE `purchase_orders` DROP COLUMN `closed_at`, DROP COLUMN `closed_by`, DROP COLUMN `close_reason`,
--     DROP COLUMN `short_amount`, DROP COLUMN `penalty_amount`;
--   ALTER TABLE `pr_items` DROP FOREIGN KEY `fk_pr_items_balance_of`;
--   ALTER TABLE `pr_items` DROP COLUMN `balance_of`;
--   ALTER TABLE `lot_items` DROP COLUMN `short_quantity`;

ALTER TABLE `lot_items`
  ADD COLUMN `short_quantity` DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER `unit_price`;

ALTER TABLE `pr_items`
  ADD COLUMN `balance_of` INT UNSIGNED NULL AFTER `drop_reason`,
  ADD CONSTRAINT `fk_pr_items_balance_of` FOREIGN KEY (`balance_of`) REFERENCES `pr_items` (`id`) ON DELETE SET NULL;

ALTER TABLE `purchase_orders`
  ADD COLUMN `closed_at`      DATETIME      NULL AFTER `reschedule_reason`,
  ADD COLUMN `closed_by`      INT UNSIGNED  NULL AFTER `closed_at`,
  ADD COLUMN `close_reason`   VARCHAR(1000) NULL AFTER `closed_by`,
  ADD COLUMN `short_amount`   DECIMAL(15,2) NULL AFTER `close_reason`,
  ADD COLUMN `penalty_amount` DECIMAL(15,2) NULL AFTER `short_amount`,
  ADD CONSTRAINT `fk_po_closed_by` FOREIGN KEY (`closed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;
