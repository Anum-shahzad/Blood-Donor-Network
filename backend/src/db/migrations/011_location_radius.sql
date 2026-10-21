-- Location for the donor "Maximum Alert Radius".
--
--   mysql -u <user> -p <database> < src/db/migrations/011_location_radius.sql
--
-- donor_profiles.latitude / longitude : where the donor chose to be located
--   ("Use my current location"). Optional; stored rounded (~100 m). Never sent
--   to requesters. When empty, the donor's city centre is used instead.
-- requests.latitude / longitude       : optional exact hospital location sent
--   when the requester pins it on the request form. When empty, the request's
--   city centre is used instead (distance is then approximate).
--
-- Additive and safe to re-run.

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donor_profiles' AND COLUMN_NAME = 'latitude');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE donor_profiles ADD COLUMN latitude DECIMAL(9,6) NULL, ADD COLUMN longitude DECIMAL(9,6) NULL',
  'SELECT ''donor_profiles location already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requests' AND COLUMN_NAME = 'latitude');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE requests ADD COLUMN latitude DECIMAL(9,6) NULL, ADD COLUMN longitude DECIMAL(9,6) NULL',
  'SELECT ''requests location already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
