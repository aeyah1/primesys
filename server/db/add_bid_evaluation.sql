-- Migration: the TWG evaluates every bid before the BAC awards.
--
-- The canvasser gives the returned RFQs to the BAC, which enters each
-- supplier's quotation (its RFQ file, the number of its RFQ, and its prices)
-- and sends them to the TWG. The TWG marks each bid compliant or non-compliant
-- (with the reason) against the offered specification and certifies them; the
-- certificate lists every bid. The BAC then picks each lot's winner, the
-- system recommending the lowest compliant total.
--
-- Run AFTER add_canvass_bids.sql.

ALTER TABLE `canvass_bidders` ADD COLUMN `rfq_no` VARCHAR(50) NULL AFTER `name`;
ALTER TABLE `canvass_bidders` ADD COLUMN `attachment_id` INT UNSIGNED NULL AFTER `rfq_no`;
ALTER TABLE `canvass_bidders` ADD CONSTRAINT `fk_canvass_bidders_file` FOREIGN KEY (`attachment_id`) REFERENCES `pr_attachments` (`id`) ON DELETE SET NULL;

ALTER TABLE `canvass_bids` ADD COLUMN `compliant` TINYINT(1) NULL;
ALTER TABLE `canvass_bids` ADD COLUMN `offered_spec` VARCHAR(1000) NULL;
ALTER TABLE `canvass_bids` ADD COLUMN `remarks` VARCHAR(500) NULL;
ALTER TABLE `canvass_bids` ADD COLUMN `certificate_id` INT UNSIGNED NULL;
ALTER TABLE `canvass_bids` ADD CONSTRAINT `fk_canvass_bids_certificate` FOREIGN KEY (`certificate_id`) REFERENCES `twg_certificates` (`id`) ON DELETE SET NULL;
