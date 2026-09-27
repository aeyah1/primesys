-- Migration: the BAC evaluates the quotations and awards; Procurement is its Secretariat.
--
-- add_bac.sql had Procurement pick the winners and the BAC approve them. The
-- law gives the evaluation and the award recommendation to the BAC (RA 12009
-- IRR 34.3g, 42.1f); the procurement unit is its Secretariat (44.1). So:
--
-- 1. Procurement records the quotations and submits the PR to the BAC
--    (purchase_requests.bac_submitted_at / _by). Quotations lock while the BAC
--    has it. The BAC awards, or returns it with a reason (bac_return_reason).
-- 2. The BAC may mark a quotation as failing the specifications
--    (quotations.disqualified_reason / _by); it can't then be awarded.
-- 3. The 'recommended' award state is retired. Any such lot is cancelled with
--    a note first, so the ENUM can drop the value.
--
-- Run AFTER add_bac.sql.
-- Rollback: the statements at the bottom of this file.

ALTER TABLE `purchase_requests`
  ADD COLUMN `bac_submitted_at`  DATETIME     NULL AFTER `mode_of_procurement`,
  ADD COLUMN `bac_submitted_by`  INT UNSIGNED NULL AFTER `bac_submitted_at`,
  ADD COLUMN `bac_return_reason` VARCHAR(500) NULL AFTER `bac_submitted_by`,
  ADD CONSTRAINT `fk_pr_bac_submitted_by` FOREIGN KEY (`bac_submitted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;

ALTER TABLE `quotations`
  ADD COLUMN `disqualified_reason` VARCHAR(500) NULL AFTER `notes`,
  ADD COLUMN `disqualified_by`     INT UNSIGNED NULL AFTER `disqualified_reason`,
  ADD CONSTRAINT `fk_quotations_disqualified_by` FOREIGN KEY (`disqualified_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;

UPDATE `lots`
   SET `status` = 'cancelled', `notes` = CONCAT_WS('\n', `notes`, 'Recommendation retired when the BAC began evaluating quotations itself')
 WHERE `status` = 'recommended';

ALTER TABLE `lots`
  MODIFY `status` ENUM('draft','open','closed','awarded','cancelled') NOT NULL DEFAULT 'draft';

-- Rollback
-- ALTER TABLE `lots` MODIFY `status` ENUM('draft','open','closed','recommended','awarded','cancelled') NOT NULL DEFAULT 'draft';
-- ALTER TABLE `quotations` DROP FOREIGN KEY `fk_quotations_disqualified_by`, DROP COLUMN `disqualified_by`, DROP COLUMN `disqualified_reason`;
-- ALTER TABLE `purchase_requests` DROP FOREIGN KEY `fk_pr_bac_submitted_by`,
--   DROP COLUMN `bac_return_reason`, DROP COLUMN `bac_submitted_by`, DROP COLUMN `bac_submitted_at`;
