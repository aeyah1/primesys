-- Wipe all users and transactional data, then restore the default admin.
-- Use it to clear test/demo records from the local `primesys` database.
-- To keep the users, use database/clear_records.sql instead.
-- Safe to re-run.
--
-- Uses DELETE FROM (not TRUNCATE) because MySQL refuses to TRUNCATE
-- tables referenced by foreign keys even with FOREIGN_KEY_CHECKS=0.
-- AUTO_INCREMENT is reset manually afterwards.
--
-- Run:  C:\xampp\mysql\bin\mysql.exe -u root primesys < database/reset_data.sql

SET FOREIGN_KEY_CHECKS = 0;

-- Child tables first (defensive; FK_CHECKS=0 makes order moot for DELETE)
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
DELETE FROM ppmp_attachments;
DELETE FROM ppmp_items;
DELETE FROM ppmps;
DELETE FROM notifications;
DELETE FROM reminders;
DELETE FROM password_reset_tokens;
DELETE FROM twg_assignments;
DELETE FROM users;

-- Reset ID counters so new data starts at id=1
ALTER TABLE purchase_requests     AUTO_INCREMENT = 1;
ALTER TABLE pr_items              AUTO_INCREMENT = 1;
ALTER TABLE pr_attachments        AUTO_INCREMENT = 1;
ALTER TABLE pr_status_logs        AUTO_INCREMENT = 1;
ALTER TABLE lots                  AUTO_INCREMENT = 1;
ALTER TABLE lot_items             AUTO_INCREMENT = 1;
ALTER TABLE canvass_bidders       AUTO_INCREMENT = 1;
ALTER TABLE canvass_bids          AUTO_INCREMENT = 1;
ALTER TABLE bac_resolutions       AUTO_INCREMENT = 1;
ALTER TABLE twg_certificates      AUTO_INCREMENT = 1;
ALTER TABLE purchase_orders       AUTO_INCREMENT = 1;
ALTER TABLE deliveries            AUTO_INCREMENT = 1;
ALTER TABLE delivery_attachments  AUTO_INCREMENT = 1;
ALTER TABLE ppmps                 AUTO_INCREMENT = 1;
ALTER TABLE ppmp_items            AUTO_INCREMENT = 1;
ALTER TABLE ppmp_attachments      AUTO_INCREMENT = 1;
ALTER TABLE notifications         AUTO_INCREMENT = 1;
ALTER TABLE reminders             AUTO_INCREMENT = 1;
ALTER TABLE password_reset_tokens AUTO_INCREMENT = 1;
ALTER TABLE users                 AUTO_INCREMENT = 1;

SET FOREIGN_KEY_CHECKS = 1;

-- Default admin, same as database/schema.sql:
-- username `admin` / password `Admin@1234`; put your own email here before running.
INSERT INTO `users` (`name`, `username`, `email`, `password_hash`, `role`, `is_active`, `is_verified`) VALUES
  ('System Administrator', 'admin', 'admin@example.com','$2a$10$6M98Da8LCoGWN.6XMDRC8ueqg77kil5.cSOEoQjbDMg8EyF0/RHKu', 'admin', 1, 1);

-- quarters and org_settings are kept (reference/config, not user data).
-- Uploaded files in server/uploads/ are not touched; delete them by hand if needed.
