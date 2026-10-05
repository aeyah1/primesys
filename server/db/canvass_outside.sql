-- Migration: the canvass is done outside the system, by the campus canvasser.
--
-- Once the TWG approves a request, Procurement starts its canvass and prints
-- the Request for Quotation; the canvasser canvasses the suppliers on paper.
-- Procurement then records each item's winning supplier and price, and
-- attaches the canvass documents, and submits them to the BAC. The BAC reviews
-- them: it adopts a BAC Resolution and sends the request to the TWG, or
-- returns it to Procurement. The TWG reviews it again and certifies it, or
-- returns it to the BAC. Only certified awards get a purchase order.
--
-- So the supplier list, the suppliers' quotations, the RFQs emailed to
-- suppliers, and the Notice of Award emails go, with the settings for the
-- minimum quotations and for the BAC's approval (the BAC always reviews now).
--
-- Run AFTER add_pr_ppmp_link.sql. The dropped tables' data is not kept:
-- back the database up first if it may be needed.

ALTER TABLE `purchase_requests`
  MODIFY `status` ENUM('draft','submitted','twg_review','revision_requested','rejected','bidding','bac_review','twg_certification','for_po','completed','cancelled') NOT NULL DEFAULT 'draft';
-- Requests the BAC was evaluating move to its new stage.
UPDATE `purchase_requests` SET `status` = 'bac_review' WHERE `status` = 'bidding' AND `bac_submitted_at` IS NOT NULL;
ALTER TABLE `purchase_requests` ADD COLUMN `twg_certified_by` INT UNSIGNED NULL;
ALTER TABLE `purchase_requests` ADD COLUMN `twg_certified_at` DATETIME NULL;
ALTER TABLE `purchase_requests` ADD COLUMN `twg_certification_note` TEXT NULL;
ALTER TABLE `purchase_requests` ADD COLUMN `certification_return_reason` VARCHAR(500) NULL;
ALTER TABLE `purchase_requests` ADD CONSTRAINT `fk_pr_twg_certified_by` FOREIGN KEY (`twg_certified_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;
ALTER TABLE `purchase_requests` DROP COLUMN `quotations_due`;

-- An award the TWG certified; only these get a purchase order. Awards already ordered, or ready for one, count as certified.
ALTER TABLE `lots` ADD COLUMN `certified_at` DATETIME NULL;
ALTER TABLE `lots` ADD COLUMN `certified_by` INT UNSIGNED NULL;
ALTER TABLE `lots` ADD CONSTRAINT `fk_lots_certified_by` FOREIGN KEY (`certified_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;
UPDATE `lots` l JOIN `purchase_requests` pr ON pr.id = l.purchase_request_id
   SET l.certified_at = l.created_at
 WHERE l.status = 'awarded' AND (l.po_id IS NOT NULL OR pr.status IN ('for_po', 'completed'));

ALTER TABLE `lots` DROP FOREIGN KEY `fk_lots_quotation`;
ALTER TABLE `lots` DROP FOREIGN KEY `fk_lots_supplier`;
ALTER TABLE `lots` DROP INDEX `idx_lots_quotation_id`;
ALTER TABLE `lots` DROP INDEX `idx_lots_supplier_id`;
ALTER TABLE `lots` DROP COLUMN `quotation_id`;
ALTER TABLE `lots` DROP COLUMN `supplier_id`;
ALTER TABLE `lots` DROP COLUMN `few_quotations_reason`;
ALTER TABLE `lots` DROP COLUMN `notice_sent_at`;
ALTER TABLE `lots` DROP COLUMN `notice_sent_to`;
ALTER TABLE `lots` DROP COLUMN `notice_error`;

ALTER TABLE `purchase_orders` DROP FOREIGN KEY `fk_po_supplier`;
ALTER TABLE `purchase_orders` DROP INDEX `idx_po_supplier_id`;
ALTER TABLE `purchase_orders` DROP COLUMN `supplier_id`;

DROP TABLE `rfq_invitations`;
DROP TABLE `quotation_items`;
DROP TABLE `quotations`;
DROP TABLE `suppliers`;

DELETE FROM `org_settings` WHERE `setting_key` IN ('minimum_quotations', 'bac_approval_required');
