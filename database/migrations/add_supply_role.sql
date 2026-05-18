-- Migration: Add 'supply' role to users ENUM
-- Run this once against your live database.
-- Safe to re-run — MODIFY COLUMN is idempotent if the value is already present.

ALTER TABLE users
  MODIFY COLUMN role
    ENUM('admin','procurement','extension','supply')
    NOT NULL DEFAULT 'extension';
