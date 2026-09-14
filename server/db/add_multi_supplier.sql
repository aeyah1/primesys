-- One PR, several suppliers.
--   * quotations / quotation_items: each supplier's quoted unit price per PR
--     item (the canvass), for the Abstract of Quotations and the award.
--   * An award (lot) covers specific PR items (lot_items.pr_item_id) at the
--     awarded unit price, and may come from a quotation (lots.quotation_id).
--     Different items may go to different suppliers.
--   * Each supplier's awards get their own purchase order (lots.po_id), so a
--     PR may have several active POs: "one active PO per PR" is dropped.
--   * A PR item that can't be procured can be dropped, with a reason.
-- MariaDB (XAMPP). Safe to run again.

CREATE TABLE IF NOT EXISTS `quotations` (
  `id`                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `purchase_request_id` INT UNSIGNED NOT NULL,
  `supplier_name`       VARCHAR(200) NOT NULL,
  `supplier_contact`    VARCHAR(100) NULL,
  `supplier_address`    TEXT         NULL,
  `supplier_phone`      VARCHAR(50)  NULL,
  `supplier_email`      VARCHAR(150) NULL,
  `supplier_tin`        VARCHAR(50)  NULL,
  `quoted_at`           DATE         NULL,
  `notes`               TEXT         NULL,
  `created_by`          INT UNSIGNED NOT NULL,
  `created_at`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_quotations_pr_id` (`purchase_request_id`),
  CONSTRAINT `fk_quotations_pr`   FOREIGN KEY (`purchase_request_id`) REFERENCES `purchase_requests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_quotations_user` FOREIGN KEY (`created_by`)          REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `quotation_items` (
  `quotation_id` INT UNSIGNED  NOT NULL,
  `pr_item_id`   INT UNSIGNED  NOT NULL,
  `unit_price`   DECIMAL(15,2) NOT NULL,
  PRIMARY KEY (`quotation_id`, `pr_item_id`),
  KEY `idx_quotation_items_pr_item` (`pr_item_id`),
  CONSTRAINT `fk_quotation_items_quotation` FOREIGN KEY (`quotation_id`) REFERENCES `quotations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_quotation_items_pr_item`   FOREIGN KEY (`pr_item_id`)   REFERENCES `pr_items` (`id`)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `pr_items`
  ADD COLUMN IF NOT EXISTS `dropped_at`  DATETIME     NULL,
  ADD COLUMN IF NOT EXISTS `dropped_by`  INT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS `drop_reason` VARCHAR(500) NULL,
  ADD CONSTRAINT `fk_pr_items_dropped_by` FOREIGN KEY IF NOT EXISTS (`dropped_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;

ALTER TABLE `lots`
  ADD COLUMN IF NOT EXISTS `quotation_id` INT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS `po_id`        INT UNSIGNED NULL,
  ADD KEY IF NOT EXISTS `idx_lots_quotation_id` (`quotation_id`),
  ADD KEY IF NOT EXISTS `idx_lots_po_id` (`po_id`),
  ADD CONSTRAINT `fk_lots_quotation` FOREIGN KEY IF NOT EXISTS (`quotation_id`) REFERENCES `quotations` (`id`)      ON DELETE SET NULL,
  ADD CONSTRAINT `fk_lots_po`        FOREIGN KEY IF NOT EXISTS (`po_id`)        REFERENCES `purchase_orders` (`id`) ON DELETE SET NULL;

ALTER TABLE `lot_items`
  ADD COLUMN IF NOT EXISTS `pr_item_id` INT UNSIGNED  NULL AFTER `lot_id`,
  ADD COLUMN IF NOT EXISTS `unit_price` DECIMAL(15,2) NULL,
  ADD KEY IF NOT EXISTS `idx_lot_items_pr_item` (`pr_item_id`),
  ADD CONSTRAINT `fk_lot_items_pr_item` FOREIGN KEY IF NOT EXISTS (`pr_item_id`) REFERENCES `pr_items` (`id`) ON DELETE SET NULL;

ALTER TABLE `purchase_orders`
  DROP INDEX IF EXISTS `uq_active_po_per_pr`,
  DROP COLUMN IF EXISTS `active_pr_id`;

-- Awards made before this change: their PR's one active PO covers them.
UPDATE `lots` l
  JOIN `purchase_orders` po ON po.purchase_request_id = l.purchase_request_id AND po.po_status = 'active'
   SET l.po_id = po.id
 WHERE l.status = 'awarded' AND l.po_id IS NULL;
