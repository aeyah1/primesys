-- Migration: purchase request items drawn from the office's verified Final PPMP.
--
-- Each PR item names the PPMP line it comes from. A PR holds that quantity of
-- the line from submission until it is rejected, cancelled, or deleted (an
-- item dropped from the procurement gives its quantity back), and can't be
-- submitted for more than the line has left (server/utils/ppmpUse.js).
--
-- Run AFTER add_ppmp.sql.
-- Rollback:
--   ALTER TABLE `pr_items` DROP FOREIGN KEY `fk_pr_items_ppmp_item`;
--   ALTER TABLE `pr_items` DROP COLUMN `ppmp_item_id`;

ALTER TABLE `pr_items` ADD COLUMN `ppmp_item_id` INT UNSIGNED NULL AFTER `pr_id`;
ALTER TABLE `pr_items` ADD KEY `idx_pr_items_ppmp_item` (`ppmp_item_id`);
ALTER TABLE `pr_items` ADD CONSTRAINT `fk_pr_items_ppmp_item` FOREIGN KEY (`ppmp_item_id`) REFERENCES `ppmp_items` (`id`);
