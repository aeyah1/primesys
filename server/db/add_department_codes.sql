-- Run this in phpMyAdmin to add department code columns to the users table
-- Safe to re-run: uses the same IF NOT EXISTS procedure pattern

DROP PROCEDURE IF EXISTS _add_col;

DELIMITER $$
CREATE PROCEDURE _add_col(IN tbl VARCHAR(64), IN col VARCHAR(64), IN defn TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = col
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', defn);
    PREPARE st FROM @sql;
    EXECUTE st;
    DEALLOCATE PREPARE st;
  END IF;
END$$
DELIMITER ;

CALL _add_col('users', 'fund_cluster',               'VARCHAR(100) NULL');
CALL _add_col('users', 'responsibility_center_code', 'VARCHAR(100) NULL');

DROP PROCEDURE IF EXISTS _add_col;
