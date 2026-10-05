-- Migration: who requested a PR, typed by the Fund Administrator, and their signature.
--
-- The Fund Administrator files the request for whoever asked for it (for
-- example the head of the office), typing the name and designation printed on
-- "Requested by"; the office head is suggested. That person can sign on the
-- screen, or a picture of their signature can be uploaded; the form prints it
-- on the signature line. Unsigned, the form keeps a blank line to sign by hand.
--
-- Run AFTER canvass_outside.sql.

ALTER TABLE `purchase_requests` ADD COLUMN `requested_by_signature` MEDIUMTEXT NULL;
ALTER TABLE `purchase_requests` ADD COLUMN `requested_by_sign_method` ENUM('drawn','uploaded') NULL;
ALTER TABLE `purchase_requests` ADD COLUMN `requested_by_signed_at` DATETIME NULL;
