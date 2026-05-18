-- Add po_status column to purchase_orders (safe to re-run)
ALTER TABLE `purchase_orders`
  ADD COLUMN IF NOT EXISTS `po_status`
    ENUM('pending_approval','approved') NOT NULL DEFAULT 'approved'
    AFTER `notes`;
