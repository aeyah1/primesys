-- Clear every procurement record but keep the accounts: users, their TWG review
-- areas, and the setup they rely on (offices, quarters, campus settings).
-- Use it to start fresh after testing. Safe to re-run. Back up first:
--   C:\xampp\mysql\bin\mysqldump.exe -u root primesys > primesys-backup.sql
--
-- Uses DELETE FROM (not TRUNCATE) because MySQL refuses to TRUNCATE
-- tables referenced by foreign keys even with FOREIGN_KEY_CHECKS=0.
--
-- Run:  C:\xampp\mysql\bin\mysql.exe -u root primesys < database/clear_records.sql
-- Then empty server/uploads/pr, delivery, canvass and ppmp (or the Supabase Storage bucket).

SET FOREIGN_KEY_CHECKS = 0;

-- Purchase requests and everything that hangs off them
DELETE FROM pr_reads;
DELETE FROM pr_status_logs;
DELETE FROM pr_attachments;
DELETE FROM canvass_bids;
DELETE FROM canvass_bidders;
DELETE FROM twg_certificates;
DELETE FROM bac_resolutions;
DELETE FROM delivery_items;
DELETE FROM delivery_attachments;
DELETE FROM deliveries;
DELETE FROM purchase_orders;
DELETE FROM lot_items;
DELETE FROM lots;
DELETE FROM pr_items;
DELETE FROM purchase_requests;

-- Offices' PPMPs
DELETE FROM ppmp_attachments;
DELETE FROM ppmp_items;
DELETE FROM ppmps;

-- Messages about those records
DELETE FROM notifications;
DELETE FROM reminders;

-- Reset ID counters so new records start at id=1
ALTER TABLE purchase_requests    AUTO_INCREMENT = 1;
ALTER TABLE pr_items             AUTO_INCREMENT = 1;
ALTER TABLE pr_attachments       AUTO_INCREMENT = 1;
ALTER TABLE pr_status_logs       AUTO_INCREMENT = 1;
ALTER TABLE lots                 AUTO_INCREMENT = 1;
ALTER TABLE lot_items            AUTO_INCREMENT = 1;
ALTER TABLE canvass_bidders      AUTO_INCREMENT = 1;
ALTER TABLE canvass_bids         AUTO_INCREMENT = 1;
ALTER TABLE bac_resolutions      AUTO_INCREMENT = 1;
ALTER TABLE twg_certificates     AUTO_INCREMENT = 1;
ALTER TABLE purchase_orders      AUTO_INCREMENT = 1;
ALTER TABLE deliveries           AUTO_INCREMENT = 1;
ALTER TABLE delivery_attachments AUTO_INCREMENT = 1;
ALTER TABLE ppmps                AUTO_INCREMENT = 1;
ALTER TABLE ppmp_items           AUTO_INCREMENT = 1;
ALTER TABLE ppmp_attachments     AUTO_INCREMENT = 1;
ALTER TABLE notifications        AUTO_INCREMENT = 1;
ALTER TABLE reminders            AUTO_INCREMENT = 1;

SET FOREIGN_KEY_CHECKS = 1;

-- Kept: users, twg_assignments, password_reset_tokens, departments, quarters, org_settings.
