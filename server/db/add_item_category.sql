-- Migration: each item carries its own category, and the request's category is
-- worked out from them.
--
-- A request's category decides which TWG members review it (twg_assignments).
-- Until now the person filing picked one for the whole request, which is a
-- guess they often get wrong and which a real request does not fit: the
-- campus's own February 2026 form has printer ink and paper (office supplies),
-- a tower extension (hardware) and desks (furniture) on one PR.
--
-- Items now carry their own category, and the request's is derived from them:
-- the category its items are worth the most in. The request still holds a
-- single category, so routing is unchanged - but it is now a fact about what is
-- being bought rather than an answer to a question.
--
-- This also lays the ground for routing a request to every area its items touch
-- rather than just the largest, which needs no further migration.
--
-- Run AFTER add_procurement_mode.sql.
-- Rollback: the statement at the bottom of this file.

ALTER TABLE `pr_items`
  ADD COLUMN `category` ENUM('hardware','office_supplies','lab_educational','furniture','food_catering','event_supplies') NULL
  AFTER `group_label`;

CREATE INDEX `idx_pr_items_category` ON `pr_items` (`category`);

-- Existing items take the category their request was filed under, so nothing
-- changes for requests already on record.
UPDATE `pr_items` i
  JOIN `purchase_requests` pr ON pr.id = i.pr_id
   SET i.category = pr.category
 WHERE i.category IS NULL;

-- Rollback
-- DROP INDEX `idx_pr_items_category` ON `pr_items`;
-- ALTER TABLE `pr_items` DROP COLUMN `category`;
