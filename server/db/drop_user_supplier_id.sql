-- Removes users.supplier_id, left over from the abandoned supplier portal
-- (competitive bidding). Nothing reads it: it was only copied into the login
-- token. database/schema.sql no longer has it, so fresh installs skip this.
-- Safe to re-run (MariaDB).
ALTER TABLE `users` DROP COLUMN IF EXISTS `supplier_id`;
