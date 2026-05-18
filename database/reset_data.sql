-- Wipe all transactional data and re-seed only the admin.
-- Use BEFORE publishing the repo to remove any test/demo records.
-- Safe to re-run.
--
-- Uses DELETE FROM (not TRUNCATE) because MySQL refuses to TRUNCATE
-- tables referenced by foreign keys even with FOREIGN_KEY_CHECKS=0.
-- AUTO_INCREMENT is reset manually afterwards.

SET FOREIGN_KEY_CHECKS = 0;

-- Child tables first (defensive; FK_CHECKS=0 makes order moot for DELETE)
DELETE FROM pr_reads;
DELETE FROM pr_status_logs;
DELETE FROM delivery_attachments;
DELETE FROM pr_attachments;
DELETE FROM bidding_results;
DELETE FROM reminders;
DELETE FROM deliveries;
DELETE FROM purchase_orders;
DELETE FROM lots;
DELETE FROM notifications;
DELETE FROM password_reset_tokens;
DELETE FROM purchase_requests;
DELETE FROM suppliers;
DELETE FROM users;

-- Reset ID counters so re-seeded data starts at id=1
ALTER TABLE pr_reads              AUTO_INCREMENT = 1;
ALTER TABLE pr_status_logs        AUTO_INCREMENT = 1;
ALTER TABLE delivery_attachments  AUTO_INCREMENT = 1;
ALTER TABLE pr_attachments        AUTO_INCREMENT = 1;
ALTER TABLE bidding_results       AUTO_INCREMENT = 1;
ALTER TABLE reminders             AUTO_INCREMENT = 1;
ALTER TABLE deliveries            AUTO_INCREMENT = 1;
ALTER TABLE purchase_orders       AUTO_INCREMENT = 1;
ALTER TABLE lots                  AUTO_INCREMENT = 1;
ALTER TABLE notifications         AUTO_INCREMENT = 1;
ALTER TABLE password_reset_tokens AUTO_INCREMENT = 1;
ALTER TABLE purchase_requests     AUTO_INCREMENT = 1;
ALTER TABLE suppliers             AUTO_INCREMENT = 1;
ALTER TABLE users                 AUTO_INCREMENT = 1;

SET FOREIGN_KEY_CHECKS = 1;

-- quarters and org_settings are kept (reference/config, not user data).
-- Next: re-run `node server/seed.js` to re-create the admin account.
