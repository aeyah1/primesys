-- Migration: a PPMP's items by quarter.
--
-- The PPMP's month columns give each line's quantity per quarter (Jan to Mar
-- is Q1). A Fund Administrator files a request under a quarter of the PPMP's
-- year; it is filled with that quarter's items and may take up to what is left
-- of each one's quarter quantity. The four quarters of every PPMP year are
-- added (not active) so a request can be filed under any of them.
--
-- Run AFTER add_bid_evaluation.sql, then fill the PPMPs already uploaded from
-- their stored files: node server/db/fill_ppmp_quarters.js

ALTER TABLE `ppmp_items` ADD COLUMN `qty_q1` DECIMAL(10,2) NULL AFTER `months`;
ALTER TABLE `ppmp_items` ADD COLUMN `qty_q2` DECIMAL(10,2) NULL AFTER `qty_q1`;
ALTER TABLE `ppmp_items` ADD COLUMN `qty_q3` DECIMAL(10,2) NULL AFTER `qty_q2`;
ALTER TABLE `ppmp_items` ADD COLUMN `qty_q4` DECIMAL(10,2) NULL AFTER `qty_q3`;

INSERT IGNORE INTO `quarters` (`label`, `year`, `start_date`, `end_date`)
SELECT q.label, y.fiscal_year, CONCAT(y.fiscal_year, q.starts), CONCAT(y.fiscal_year, q.ends)
  FROM (SELECT DISTINCT `fiscal_year` FROM `ppmps`) y
  CROSS JOIN (SELECT 'Q1' AS label, '-01-01' AS starts, '-03-31' AS ends
              UNION ALL SELECT 'Q2', '-04-01', '-06-30'
              UNION ALL SELECT 'Q3', '-07-01', '-09-30'
              UNION ALL SELECT 'Q4', '-10-01', '-12-31') q;
