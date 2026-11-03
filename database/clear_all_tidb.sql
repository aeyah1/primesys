-- Clear the online database (TiDB Cloud) back to a fresh start: every record, every PPMP and every account
-- except the admins. Kept: admin accounts and the setup (offices, quarters, campus settings, officials' signatures).
-- Export a backup first (Import/Export in TiDB Cloud), then paste all of it into the TiDB Cloud SQL Editor and run it.
-- Afterwards empty the Supabase Storage bucket folders pr, delivery and ppmp (the uploaded files). Safe to re-run.
--
-- To see which accounts are kept, run this line alone first:
--   SELECT id, username, name FROM users WHERE role = 'admin';
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

-- Purchase requests and their quotations
DELETE FROM pr_items;
DELETE FROM canvass_bidders;
DELETE FROM pr_attachments;
DELETE FROM pr_status_logs;
DELETE FROM pr_reads;
DELETE FROM purchase_requests;

-- Supplier profiles
DELETE FROM suppliers;

-- Offices' PPMPs
DELETE FROM ppmp_attachments;
DELETE FROM ppmp_items;
DELETE FROM ppmps;

-- Notifications, the Audit Log and sign-in records (admins sign in without the emailed code, so nothing is lost)
DELETE FROM notifications;
DELETE FROM audit_logs;
DELETE FROM user_devices;
DELETE FROM password_reset_tokens;

-- RFQ History back to locked until the BAC opens it
DELETE FROM org_settings WHERE setting_key IN ('rfq_history_open', 'rfq_history_until', 'rfq_history_by', 'rfq_history_at');

-- Accounts: everyone except the admins
DELETE FROM twg_assignments;
DELETE FROM users WHERE role <> 'admin';

-- Restart ID counters at 1 (TiDB needs FORCE to lower them; safe because the tables are empty)
ALTER TABLE purchase_requests     FORCE AUTO_INCREMENT = 1;
ALTER TABLE pr_items              FORCE AUTO_INCREMENT = 1;
ALTER TABLE pr_attachments        FORCE AUTO_INCREMENT = 1;
ALTER TABLE pr_status_logs        FORCE AUTO_INCREMENT = 1;
ALTER TABLE lots                  FORCE AUTO_INCREMENT = 1;
ALTER TABLE lot_items             FORCE AUTO_INCREMENT = 1;
ALTER TABLE suppliers             FORCE AUTO_INCREMENT = 1;
ALTER TABLE canvass_bidders       FORCE AUTO_INCREMENT = 1;
ALTER TABLE canvass_bids          FORCE AUTO_INCREMENT = 1;
ALTER TABLE bac_resolutions       FORCE AUTO_INCREMENT = 1;
ALTER TABLE twg_certificates      FORCE AUTO_INCREMENT = 1;
ALTER TABLE purchase_orders       FORCE AUTO_INCREMENT = 1;
ALTER TABLE deliveries            FORCE AUTO_INCREMENT = 1;
ALTER TABLE delivery_attachments  FORCE AUTO_INCREMENT = 1;
ALTER TABLE ppmps                 FORCE AUTO_INCREMENT = 1;
ALTER TABLE ppmp_items            FORCE AUTO_INCREMENT = 1;
ALTER TABLE ppmp_attachments      FORCE AUTO_INCREMENT = 1;
ALTER TABLE notifications         FORCE AUTO_INCREMENT = 1;
ALTER TABLE reminders             FORCE AUTO_INCREMENT = 1;
ALTER TABLE audit_logs            FORCE AUTO_INCREMENT = 1;
ALTER TABLE user_devices          FORCE AUTO_INCREMENT = 1;
ALTER TABLE password_reset_tokens FORCE AUTO_INCREMENT = 1;
-- users is not restarted: the admins keep their IDs and new accounts continue after them.

-- Check: every count is 0 except the kept admins
SELECT 'purchase_requests' AS tbl, COUNT(*) AS n FROM purchase_requests
UNION ALL SELECT 'pr_items', COUNT(*) FROM pr_items
UNION ALL SELECT 'pr_attachments', COUNT(*) FROM pr_attachments
UNION ALL SELECT 'pr_status_logs', COUNT(*) FROM pr_status_logs
UNION ALL SELECT 'pr_reads', COUNT(*) FROM pr_reads
UNION ALL SELECT 'suppliers', COUNT(*) FROM suppliers
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
UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs
UNION ALL SELECT 'user_devices', COUNT(*) FROM user_devices
UNION ALL SELECT 'password_reset_tokens', COUNT(*) FROM password_reset_tokens
UNION ALL SELECT 'twg_assignments', COUNT(*) FROM twg_assignments
UNION ALL SELECT 'users that are not admins', COUNT(*) FROM users WHERE role <> 'admin'
UNION ALL SELECT 'admins (kept)', COUNT(*) FROM users WHERE role = 'admin';

-- Kept: admin accounts, departments, quarters, org_settings (except the RFQ History lock), org_signatures.
