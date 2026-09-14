-- Admin approval for self-registered privileged accounts.
--
-- Public sign-up may choose requestor, procurement, supply, or twg. Requestor
-- accounts are approved immediately; procurement / supply / twg accounts are
-- created with is_approved = 0 and cannot sign in until an admin approves them
-- in User Management. Admin-created accounts are always approved.
--
-- DEFAULT 1 means every existing account is approved, so nobody is locked out.
-- Run this BEFORE starting the server code that reads the column (login).
-- ADD COLUMN IF NOT EXISTS works on MariaDB (XAMPP); safe to re-run.
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `is_approved` TINYINT(1) NOT NULL DEFAULT 1;
