-- Retires users.is_approved, left over from the retired role-request sign-up (audit DB-5).
-- Accounts still waiting for approval are deactivated first, so none can sign in until an admin reactivates them.
-- Run it after updating the server code, which no longer reads the column.
-- Safe to re-run (MariaDB): once the column is gone it does nothing.
DROP PROCEDURE IF EXISTS _drop_user_approval;
DELIMITER $$
CREATE PROCEDURE _drop_user_approval()
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_approved') THEN
    UPDATE `users` SET `is_active` = 0 WHERE `is_approved` = 0;
    ALTER TABLE `users` DROP COLUMN `is_approved`;
  END IF;
END$$
DELIMITER ;
CALL _drop_user_approval();
DROP PROCEDURE _drop_user_approval;
