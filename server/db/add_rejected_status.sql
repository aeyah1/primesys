-- Migration: add 'rejected' to PR status ENUM.
-- TWG can now reject a PR outright (terminal state, doesn't go to procurement).
-- Comment is required for rejection (enforced in twg.controller.js).
ALTER TABLE `purchase_requests`
  MODIFY COLUMN `status`
    ENUM('draft','submitted','twg_review','revision_requested','rejected','bidding','for_po','completed','cancelled')
    NOT NULL DEFAULT 'draft';
