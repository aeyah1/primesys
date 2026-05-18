-- Password reset tokens table
-- Run once: Get-Content server/db/create_reset_tokens.sql | & "C:\xampp\mysql\bin\mysql.exe" -u root primesys

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT         NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  expires_at DATETIME    NOT NULL,
  used       TINYINT(1)  NOT NULL DEFAULT 0,
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_prt_token_hash (token_hash),
  INDEX idx_prt_user_id    (user_id)
);
