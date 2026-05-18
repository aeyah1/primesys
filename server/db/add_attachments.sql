-- PR Attachments
CREATE TABLE IF NOT EXISTS `pr_attachments` (
  `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `pr_id`         INT UNSIGNED NOT NULL,
  `filename`      VARCHAR(255) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `mimetype`      VARCHAR(100),
  `size`          INT UNSIGNED,
  `uploaded_by`   INT UNSIGNED NOT NULL,
  `created_at`    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`pr_id`)       REFERENCES `purchase_requests`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`)
);

-- Delivery Attachments (supplier invoices / proof of delivery)
CREATE TABLE IF NOT EXISTS `delivery_attachments` (
  `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `delivery_id`   INT UNSIGNED NOT NULL,
  `filename`      VARCHAR(255) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `mimetype`      VARCHAR(100),
  `size`          INT UNSIGNED,
  `uploaded_by`   INT UNSIGNED NOT NULL,
  `created_at`    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`delivery_id`) REFERENCES `deliveries`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`)
);
