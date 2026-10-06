-- Migration: saved signatures of the campus officials named in Settings > Organization.
--
-- An admin saves the signature of each person named to sign the forms (approvers, the
-- certifying officers, the BAC chairman, vice chairman and members, the canvassers), with
-- their consent, drawn on the screen or uploaded. It is kept under the person's name, and
-- prints over that name once their step is done (utils/orgSignatures.js), on staff copies.
-- A name changed or removed in the settings takes its signature with it.
--
-- Run AFTER add_pr_delete_reason.sql. Safe to re-run.

CREATE TABLE IF NOT EXISTS `org_signatures` (
  `name_key`    VARCHAR(150) NOT NULL,   -- the signatory's name in lower case, spaces collapsed
  `name`        VARCHAR(150) NOT NULL,
  `image`       MEDIUMTEXT   NOT NULL,   -- PNG data URL
  `sign_method` ENUM('drawn','uploaded') NOT NULL,
  `saved_by`    INT UNSIGNED NULL,
  `updated_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`name_key`),
  CONSTRAINT `fk_org_signatures_by` FOREIGN KEY (`saved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
