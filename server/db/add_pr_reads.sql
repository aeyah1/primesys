-- Per-user "I have viewed this PR" markers, replacing the previous
-- localStorage-only tracker in the client. Lets read state survive
-- browser clears, sync across devices, and (later) feed admin reports.
CREATE TABLE IF NOT EXISTS `pr_reads` (
  `user_id` INT UNSIGNED NOT NULL,
  `pr_id`   INT UNSIGNED NOT NULL,
  `read_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `pr_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)             ON DELETE CASCADE,
  FOREIGN KEY (`pr_id`)   REFERENCES `purchase_requests`(`id`) ON DELETE CASCADE,
  INDEX `idx_pr_reads_user` (`user_id`)
);
