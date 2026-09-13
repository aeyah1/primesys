-- Deliveries by item: each delivery records how much of each line of its PO
-- (the PO's awarded lot items) arrived, so a PO is delivered once every line
-- is received in full, and the inspection report lists what actually came.
-- Also keeps the latest change to a PO's expected delivery date, and why.
-- MariaDB (XAMPP). Safe to run again.

CREATE TABLE IF NOT EXISTS `delivery_items` (
  `delivery_id` INT UNSIGNED  NOT NULL,
  `lot_item_id` INT UNSIGNED  NOT NULL,
  `quantity`    DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (`delivery_id`, `lot_item_id`),
  KEY `idx_delivery_items_lot_item` (`lot_item_id`),
  CONSTRAINT `fk_delivery_items_delivery` FOREIGN KEY (`delivery_id`) REFERENCES `deliveries` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_delivery_items_lot_item` FOREIGN KEY (`lot_item_id`) REFERENCES `lot_items` (`id`)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `purchase_orders`
  ADD COLUMN IF NOT EXISTS `rescheduled_at`    DATETIME     NULL,
  ADD COLUMN IF NOT EXISTS `reschedule_reason` VARCHAR(500) NULL;
