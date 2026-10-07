-- Migration: a TWG member's saved signature.
--
-- A TWG member may save their own signature (drawn on the screen or uploaded) so it is filled in each time they
-- approve a request or certify bids; they still see it and may sign differently or leave it off before they confirm.
-- Only its owner reads or changes it (GET/PUT/DELETE /auth/me/signature).
--
-- Run AFTER add_org_signatures.sql. Safe to re-run. One change per statement, for TiDB.

ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `saved_signature` MEDIUMTEXT NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `saved_sign_method` ENUM('drawn','uploaded') NULL;
