-- Migration: add school/event procurement category to purchase_requests.
-- Categories cover what NEMSU Cantilan Campus typically procures.
ALTER TABLE `purchase_requests`
  ADD COLUMN `category` ENUM(
    'hardware',
    'office_supplies',
    'lab_educational',
    'furniture',
    'food_catering',
    'event_supplies'
  ) NOT NULL DEFAULT 'office_supplies'
  AFTER `responsibility_center_code`;

CREATE INDEX `idx_pr_category` ON `purchase_requests` (`category`);
