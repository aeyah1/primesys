-- Migration: an admin can withdraw a PPMP put in effect by mistake.
--
-- A PPMP takes effect as soon as it is uploaded signed and complete, with no
-- one approving it, so a wrong one needs a way back. An admin withdraws it,
-- with the reason, while no request draws on its items; the version it
-- replaced (if any) is in effect again, and the office uploads the right one.
-- A withdrawn PPMP is kept on record.
--
-- Run AFTER add_pr_requester_signature.sql.

ALTER TABLE `ppmps`
  MODIFY `status` ENUM('draft','approved','superseded','withdrawn') NOT NULL DEFAULT 'draft';
ALTER TABLE `ppmps` ADD COLUMN `withdrawn_at` DATETIME NULL;
ALTER TABLE `ppmps` ADD COLUMN `withdrawn_by` INT UNSIGNED NULL;
ALTER TABLE `ppmps` ADD COLUMN `withdraw_reason` VARCHAR(500) NULL;
ALTER TABLE `ppmps` ADD CONSTRAINT `fk_ppmp_withdrawn_by` FOREIGN KEY (`withdrawn_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;
