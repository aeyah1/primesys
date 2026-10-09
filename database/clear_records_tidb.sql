-- Clear every procurement record on the online database (TiDB Cloud) but keep the accounts:
-- users, their TWG review areas, and the setup they rely on (offices, quarters, campus settings).
-- Paste all of it into the TiDB Cloud SQL Editor and run it. Safe to re-run.
-- Export a backup first (Import/Export in TiDB Cloud), then empty the Supabase Storage bucket
-- folders pr, delivery, canvass and ppmp.
--
-- Deletes run children first, so each step leaves the data consistent with foreign key checks on.

USE `primesys`;

-- Deliveries
DELETE FROM delivery_items;
DELETE FROM delivery_attachments;
DELETE FROM deliveries;

-- Awards, purchase orders and certificates
DELETE FROM reminders;
DELETE FROM canvass_bids;
DELETE FROM lot_items;
DELETE FROM lots;
DELETE FROM purchase_orders;
DELETE FROM bac_resolutions;
DELETE FROM twg_certificates;

-- Purchase requests
DELETE FROM pr_items;
DELETE FROM canvass_bidders;
DELETE FROM pr_attachments;
DELETE FROM pr_status_logs;
DELETE FROM pr_reads;
DELETE FROM purchase_requests;

-- Offices' PPMPs
DELETE FROM ppmp_attachments;
DELETE FROM ppmp_items;
DELETE FROM ppmps;

-- Messages about those records
DELETE FROM notifications;

-- Restart ID counters at 1 (TiDB needs FORCE to lower them; safe because the tables are empty)
ALTER TABLE purchase_requests    FORCE AUTO_INCREMENT = 1;
ALTER TABLE pr_items             FORCE AUTO_INCREMENT = 1;
ALTER TABLE pr_attachments       FORCE AUTO_INCREMENT = 1;
ALTER TABLE pr_status_logs       FORCE AUTO_INCREMENT = 1;
ALTER TABLE lots                 FORCE AUTO_INCREMENT = 1;
ALTER TABLE lot_items            FORCE AUTO_INCREMENT = 1;
ALTER TABLE canvass_bidders      FORCE AUTO_INCREMENT = 1;
ALTER TABLE canvass_bids         FORCE AUTO_INCREMENT = 1;
ALTER TABLE bac_resolutions      FORCE AUTO_INCREMENT = 1;
ALTER TABLE twg_certificates     FORCE AUTO_INCREMENT = 1;
ALTER TABLE purchase_orders      FORCE AUTO_INCREMENT = 1;
ALTER TABLE deliveries           FORCE AUTO_INCREMENT = 1;
ALTER TABLE delivery_attachments FORCE AUTO_INCREMENT = 1;
ALTER TABLE ppmps                FORCE AUTO_INCREMENT = 1;
ALTER TABLE ppmp_items           FORCE AUTO_INCREMENT = 1;
ALTER TABLE ppmp_attachments     FORCE AUTO_INCREMENT = 1;
ALTER TABLE notifications        FORCE AUTO_INCREMENT = 1;
ALTER TABLE reminders            FORCE AUTO_INCREMENT = 1;

-- Check: every count is 0 except the kept users
SELECT 'purchase_requests' AS tbl, COUNT(*) AS n FROM purchase_requests
UNION ALL SELECT 'pr_items', COUNT(*) FROM pr_items
UNION ALL SELECT 'pr_attachments', COUNT(*) FROM pr_attachments
UNION ALL SELECT 'pr_status_logs', COUNT(*) FROM pr_status_logs
UNION ALL SELECT 'pr_reads', COUNT(*) FROM pr_reads
UNION ALL SELECT 'canvass_bidders', COUNT(*) FROM canvass_bidders
UNION ALL SELECT 'canvass_bids', COUNT(*) FROM canvass_bids
UNION ALL SELECT 'twg_certificates', COUNT(*) FROM twg_certificates
UNION ALL SELECT 'bac_resolutions', COUNT(*) FROM bac_resolutions
UNION ALL SELECT 'lots', COUNT(*) FROM lots
UNION ALL SELECT 'lot_items', COUNT(*) FROM lot_items
UNION ALL SELECT 'purchase_orders', COUNT(*) FROM purchase_orders
UNION ALL SELECT 'deliveries', COUNT(*) FROM deliveries
UNION ALL SELECT 'delivery_items', COUNT(*) FROM delivery_items
UNION ALL SELECT 'delivery_attachments', COUNT(*) FROM delivery_attachments
UNION ALL SELECT 'ppmps', COUNT(*) FROM ppmps
UNION ALL SELECT 'ppmp_items', COUNT(*) FROM ppmp_items
UNION ALL SELECT 'ppmp_attachments', COUNT(*) FROM ppmp_attachments
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL SELECT 'reminders', COUNT(*) FROM reminders
UNION ALL SELECT 'users (kept)', COUNT(*) FROM users;

-- Kept: users, twg_assignments, password_reset_tokens, departments, quarters, org_settings, org_signatures.
