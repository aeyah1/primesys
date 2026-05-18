-- Organization-wide settings table
-- Run once in phpMyAdmin

CREATE TABLE IF NOT EXISTS org_settings (
  setting_key   VARCHAR(100) PRIMARY KEY,
  setting_value TEXT NULL,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Seed the two keys so GET always returns them (even when empty)
INSERT IGNORE INTO org_settings (setting_key, setting_value) VALUES
  ('fund_cluster',               NULL),
  ('responsibility_center_code', NULL);
