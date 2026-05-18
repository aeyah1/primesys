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

CALL _add_col('users', 'is_verified',    'TINYINT(1) NOT NULL DEFAULT 0');
CALL _add_col('users', 'verify_token',   'VARCHAR(64) NULL');
CALL _add_col('users', 'verify_expires', 'DATETIME NULL');

-- All accounts created before verification was introduced are pre-approved
UPDATE users SET is_verified = 1 WHERE verify_token IS NULL;

DROP PROCEDURE IF EXISTS _add_col;
