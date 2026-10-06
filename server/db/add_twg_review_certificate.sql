-- Migration: the TWG's certification of a purchase request.
--
-- When the TWG approves a request it now issues a Certification (Goods and
-- services) that it checked the market price and technical specifications of
-- the request's items (the campus's "twg format 2026"), besides the one it
-- issues later for the canvass bids. Both share one Cert. No. series; kind
-- tells them apart. Certificates issued before this are of the bids.
--
-- Run AFTER add_ppmp_changes.sql. Safe to re-run.

ALTER TABLE `twg_certificates` ADD COLUMN IF NOT EXISTS `kind` ENUM('review','bids') NOT NULL DEFAULT 'bids' AFTER `pr_id`;
