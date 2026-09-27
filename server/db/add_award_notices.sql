-- Migration: confirmed supplier emails, and the emailed Notice of Award.
--
-- A supplier's email counts as confirmed once the supplier quotes through the
-- link emailed to it: `email_confirmed` keeps that address, so editing the
-- email leaves it unconfirmed again. Each invitation keeps the address it went
-- to. A Notice of Award is emailed only to a confirmed address; each award
-- keeps when and where it went, or why it could not be sent.
--
-- Run AFTER add_quote_revisions.sql.
-- Rollback:
--   ALTER TABLE `suppliers` DROP COLUMN `email_confirmed`, DROP COLUMN `email_confirmed_at`;
--   ALTER TABLE `rfq_invitations` DROP COLUMN `sent_to`;
--   ALTER TABLE `lots` DROP COLUMN `notice_sent_at`, DROP COLUMN `notice_sent_to`, DROP COLUMN `notice_error`;

ALTER TABLE `suppliers`
  ADD COLUMN `email_confirmed`    VARCHAR(150) NULL AFTER `email`,
  ADD COLUMN `email_confirmed_at` DATETIME     NULL AFTER `email_confirmed`;

ALTER TABLE `rfq_invitations`
  ADD COLUMN `sent_to` VARCHAR(150) NULL AFTER `sent_at`;

ALTER TABLE `lots`
  ADD COLUMN `notice_sent_at` DATETIME     NULL AFTER `resolution_id`,
  ADD COLUMN `notice_sent_to` VARCHAR(150) NULL AFTER `notice_sent_at`,
  ADD COLUMN `notice_error`   VARCHAR(300) NULL AFTER `notice_sent_to`;

-- Invitations sent before this went to the supplier's address on file.
UPDATE `rfq_invitations` i JOIN `suppliers` s ON s.id = i.supplier_id
   SET i.sent_to = s.email
 WHERE i.sent_at IS NOT NULL AND i.sent_to IS NULL;

-- Suppliers who already quoted through their link have proven their address.
UPDATE `suppliers` s
  JOIN (SELECT supplier_id, MAX(submitted_at) AS at FROM `rfq_invitations`
         WHERE submitted_at IS NOT NULL GROUP BY supplier_id) q ON q.supplier_id = s.id
   SET s.email_confirmed = s.email, s.email_confirmed_at = q.at
 WHERE s.email IS NOT NULL;
