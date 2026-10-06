-- Migration: why a purchase request was deleted.
--
-- Deleting someone else's request now takes a reason, kept with the deleted
-- request (shown on it and in the Archive) and written to its activity log;
-- its filer, and the TWG or Procurement that had it, are notified. Once the
-- canvass has started (the PR number is assigned) a request is cancelled
-- instead of deleted.
--
-- Run AFTER add_twg_review_certificate.sql. Safe to re-run.

ALTER TABLE `purchase_requests` ADD COLUMN IF NOT EXISTS `delete_reason` VARCHAR(500) NULL AFTER `deleted_by`;
