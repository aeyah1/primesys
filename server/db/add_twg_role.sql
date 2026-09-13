-- Stops without changes on a database that already has the twg or requestor role (audit DB-4).
DROP PROCEDURE IF EXISTS _legacy_guard;
DELIMITER $$
CREATE PROCEDURE _legacy_guard()
BEGIN
  IF (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role') REGEXP '''(twg|requestor)''' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Stopped: this database already has this migration, and running it again would erase roles. No data was changed.';
  END IF;
END$$
DELIMITER ;
CALL _legacy_guard();
DROP PROCEDURE _legacy_guard;

-- Migration: Add Technical Working Group (TWG) role and review workflow.
--
-- New flow:
--   draft → submitted (TWG inbox)
--             ├── TWG approves     → twg_review        (procurement inbox)
--             └── TWG requests fix → revision_requested (back to extension; resubmit → submitted)
--   twg_review → bidding → for_po → completed
--
-- 'twg_review' semantically = "Approved by TWG, ready for procurement".

ALTER TABLE `users`
  MODIFY COLUMN `role`
    ENUM('admin','procurement','extension','supply','twg')
    NOT NULL DEFAULT 'extension';

ALTER TABLE `purchase_requests`
  MODIFY COLUMN `status`
    ENUM('draft','submitted','twg_review','revision_requested','bidding','for_po','completed','cancelled')
    NOT NULL DEFAULT 'draft';

ALTER TABLE `purchase_requests`
  ADD COLUMN `twg_reviewed_by` INT UNSIGNED NULL AFTER `created_by`,
  ADD COLUMN `twg_reviewed_at` TIMESTAMP    NULL AFTER `twg_reviewed_by`,
  ADD COLUMN `twg_comment`     TEXT         NULL AFTER `twg_reviewed_at`,
  ADD CONSTRAINT `fk_pr_twg_reviewer` FOREIGN KEY (`twg_reviewed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL;
