-- Migration: add supplier detail columns to lots table
ALTER TABLE `lots`
  ADD COLUMN `supplier_contact` VARCHAR(100)  NULL AFTER `awarded_amount`,
  ADD COLUMN `supplier_address` TEXT          NULL AFTER `supplier_contact`,
  ADD COLUMN `supplier_phone`   VARCHAR(50)   NULL AFTER `supplier_address`,
  ADD COLUMN `supplier_email`   VARCHAR(150)  NULL AFTER `supplier_phone`,
  ADD COLUMN `supplier_tin`     VARCHAR(50)   NULL AFTER `supplier_email`;
