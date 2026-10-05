-- Migration: the BAC enters the canvass bids and awards.
--
-- Procurement starts the canvass (the PR number) and prints the RFQ; the
-- canvasser canvasses the suppliers on paper and brings the bids to the BAC.
-- The BAC enters every bidder and their price for each item (read from the
-- canvasser's file or typed), picks each item's winner (the lowest by
-- default, another with a reason), and awards: a BAC Resolution, then the
-- TWG's certification. Suppliers are recorded by name only.
--
-- Run AFTER add_twg_certificates.sql.

CREATE TABLE `canvass_bidders` (
  `id`         INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  `pr_id`      INT UNSIGNED      NOT NULL,
  `name`       VARCHAR(200)      NOT NULL,
  `position`   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `created_by` INT UNSIGNED      NULL,
  `created_at` TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_canvass_bidders_pr` (`pr_id`),
  CONSTRAINT `fk_canvass_bidders_pr` FOREIGN KEY (`pr_id`)      REFERENCES `purchase_requests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_canvass_bidders_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `canvass_bids` (
  `id`         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `bidder_id`  INT UNSIGNED  NOT NULL,
  `pr_item_id` INT UNSIGNED  NOT NULL,
  `unit_price` DECIMAL(15,2) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_canvass_bid` (`bidder_id`, `pr_item_id`),
  KEY `idx_canvass_bids_item` (`pr_item_id`),
  CONSTRAINT `fk_canvass_bids_bidder` FOREIGN KEY (`bidder_id`)  REFERENCES `canvass_bidders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_canvass_bids_item`   FOREIGN KEY (`pr_item_id`) REFERENCES `pr_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `pr_items` ADD COLUMN `winner_bidder_id` INT UNSIGNED NULL AFTER `balance_of`;
ALTER TABLE `pr_items` ADD COLUMN `winner_reason` VARCHAR(500) NULL AFTER `winner_bidder_id`;
ALTER TABLE `pr_items` ADD CONSTRAINT `fk_pr_items_winner` FOREIGN KEY (`winner_bidder_id`) REFERENCES `canvass_bidders` (`id`) ON DELETE SET NULL;
