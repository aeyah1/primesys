-- Migration: awards and purchase orders name their supplier on the list.
--
-- Awards (lots) and purchase orders kept the supplier's name as it was that
-- day, so renaming a supplier on the list lost track of its history. Each now
-- also keeps the supplier's id, for the supplier's profile. Existing rows are
-- linked through the award's quotation, or else by name (ignoring case and
-- spacing, the way suppliers.name_key is made).
--
-- Run AFTER add_short_delivery.sql.
-- Rollback:
--   ALTER TABLE `lots` DROP FOREIGN KEY `fk_lots_supplier`;
--   ALTER TABLE `lots` DROP COLUMN `supplier_id`;
--   ALTER TABLE `purchase_orders` DROP FOREIGN KEY `fk_po_supplier`;
--   ALTER TABLE `purchase_orders` DROP COLUMN `supplier_id`;

ALTER TABLE `lots`
  ADD COLUMN `supplier_id` INT UNSIGNED NULL AFTER `awarded_to`,
  ADD KEY `idx_lots_supplier_id` (`supplier_id`),
  ADD CONSTRAINT `fk_lots_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE SET NULL;

ALTER TABLE `purchase_orders`
  ADD COLUMN `supplier_id` INT UNSIGNED NULL AFTER `supplier_name`,
  ADD KEY `idx_po_supplier_id` (`supplier_id`),
  ADD CONSTRAINT `fk_po_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE SET NULL;

-- Awards made from a quotation: that quotation's supplier.
UPDATE `lots` l JOIN `quotations` q ON q.id = l.quotation_id
   SET l.supplier_id = q.supplier_id
 WHERE l.supplier_id IS NULL AND q.supplier_id IS NOT NULL;

-- Other awards: the listed supplier of that name.
UPDATE `lots` l JOIN `suppliers` s ON s.name_key = LOWER(TRIM(REGEXP_REPLACE(l.awarded_to, '[[:space:]]+', ' ')))
   SET l.supplier_id = s.id
 WHERE l.supplier_id IS NULL;

-- Purchase orders: their awards' supplier, or else the listed supplier of that name.
UPDATE `purchase_orders` po JOIN `lots` l ON l.po_id = po.id AND l.supplier_id IS NOT NULL
   SET po.supplier_id = l.supplier_id
 WHERE po.supplier_id IS NULL;

UPDATE `purchase_orders` po JOIN `suppliers` s ON s.name_key = LOWER(TRIM(REGEXP_REPLACE(po.supplier_name, '[[:space:]]+', ' ')))
   SET po.supplier_id = s.id
 WHERE po.supplier_id IS NULL;
