-- Migration: face checks for staff (panel review, 2026-10-26).
--
-- TWG, Procurement, Supply and Admin accounts may set up a face check: the browser turns the camera picture into 128
-- face measurements, and only those are stored, encrypted with FILE_ENCRYPTION_KEY (never a photo). While face_check
-- is '1', staff with a face on record pass it at sign-in and before critical actions (utils/faceCheck.js).
--
-- Run once, AFTER add_file_retention.sql and BEFORE deploying the server that reads it.
-- Rollback:
--   ALTER TABLE `users` DROP COLUMN `face_template`, DROP COLUMN `face_enrolled_at`;
--   DELETE FROM `org_settings` WHERE `setting_key` = 'face_check';

ALTER TABLE `users`
  ADD COLUMN `face_template` BLOB NULL AFTER `saved_sign_method`,
  ADD COLUMN `face_enrolled_at` DATETIME NULL AFTER `face_template`;

INSERT INTO `org_settings` (`setting_key`, `setting_value`) VALUES ('face_check', '0')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;
