CREATE TABLE IF NOT EXISTS `reminders` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `title`       VARCHAR(255) NOT NULL,
  `note`        TEXT,
  `remind_at`   DATETIME NOT NULL,
  `created_by`  INT UNSIGNED NOT NULL,
  `assigned_to` INT UNSIGNED NOT NULL,
  `pr_id`       INT UNSIGNED NULL,
  `lot_id`      INT UNSIGNED NULL,
  `is_sent`     TINYINT(1) NOT NULL DEFAULT 0,
  `is_done`     TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`created_by`)  REFERENCES `users`(`id`),
  FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`),
  FOREIGN KEY (`pr_id`)       REFERENCES `purchase_requests`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`lot_id`)      REFERENCES `lots`(`id`) ON DELETE SET NULL
);
