-- PRimeSys Database Index Migrations
-- Safe: skips any table or index that doesn't exist yet

DROP PROCEDURE IF EXISTS _add_index;
DELIMITER //
CREATE PROCEDURE _add_index(IN tbl VARCHAR(64), IN idx VARCHAR(64), IN col_def TEXT)
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = tbl
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = tbl AND index_name = idx
    ) THEN
      SET @s = CONCAT('ALTER TABLE `', tbl, '` ADD INDEX `', idx, '` (', col_def, ')');
      PREPARE st FROM @s;
      EXECUTE st;
      DEALLOCATE PREPARE st;
    END IF;
  END IF;
END //
DELIMITER ;

CALL _add_index('notifications',       'idx_notifications_user_id',   'user_id');
CALL _add_index('notifications',       'idx_notifications_user_read',  'user_id, is_read');
CALL _add_index('pr_status_logs',      'idx_psl_pr_id',               'pr_id');
CALL _add_index('lots',                'idx_lots_purchase_request_id','purchase_request_id');
CALL _add_index('bidding_results',     'idx_bidding_lot_id',          'lot_id');
CALL _add_index('bidding_results',     'idx_bidding_supplier_id',     'supplier_id');
CALL _add_index('purchase_orders',     'idx_po_purchase_request_id',  'purchase_request_id');
CALL _add_index('deliveries',          'idx_deliveries_po_id',        'po_id');
CALL _add_index('purchase_requests',   'idx_pr_status',               'status');
CALL _add_index('purchase_requests',   'idx_pr_quarter_id',           'quarter_id');

DROP PROCEDURE IF EXISTS _add_index;
