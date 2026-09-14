-- TWG review areas: each TWG member reviews only the PR categories an admin
-- assigns them (User Management), and a submitted PR goes only to the
-- members who review its category.
--
-- So that no TWG member's queue empties on the day this is installed, every
-- existing TWG member is first given every area (the old behavior); the admin
-- then narrows each member's areas in User Management. That starting
-- assignment only runs while the table is empty, so running this file again
-- does not undo the admin's choices.
--
-- Run BEFORE starting the server code that reads the table.
-- Rollback: DROP TABLE `twg_assignments`; (with the old code)
CREATE TABLE IF NOT EXISTS `twg_assignments` (
  `user_id`     INT UNSIGNED NOT NULL,
  `category`    ENUM('hardware','office_supplies','lab_educational','furniture','food_catering','event_supplies') NOT NULL,
  `assigned_by` INT UNSIGNED NULL,
  `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `category`),
  KEY `idx_twg_assignments_category` (`category`),
  CONSTRAINT `fk_twg_assignments_user` FOREIGN KEY (`user_id`)     REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_twg_assignments_by`   FOREIGN KEY (`assigned_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `twg_assignments` (`user_id`, `category`)
SELECT u.id, c.category
  FROM `users` u
  CROSS JOIN (SELECT 'hardware' AS category UNION ALL SELECT 'office_supplies' UNION ALL SELECT 'lab_educational'
              UNION ALL SELECT 'furniture' UNION ALL SELECT 'food_catering' UNION ALL SELECT 'event_supplies') c
 WHERE u.role = 'twg'
   AND NOT EXISTS (SELECT 1 FROM `twg_assignments`);
