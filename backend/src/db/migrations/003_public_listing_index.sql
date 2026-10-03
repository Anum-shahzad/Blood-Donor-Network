-- Speeds up the public emergency list and the donor match list, which both
-- filter on verification + status. Additive and safe to re-run.
--
--   mysql -u <user> -p <database> < src/db/migrations/003_public_listing_index.sql

SET @idx_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requests' AND INDEX_NAME = 'idx_requests_open_listing'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE requests ADD INDEX idx_requests_open_listing (is_verified, status, required_by)',
  'SELECT ''idx_requests_open_listing already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
