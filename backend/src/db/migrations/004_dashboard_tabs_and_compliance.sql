-- Feature additions for Donor, Requester, and Admin Dashboard Tabs
-- Additive only — safe to execute on existing databases.
--
--   mysql -u <user> -p <database> < src/db/migrations/004_dashboard_tabs_and_compliance.sql

-- 1. Donations history table (tracks verified past donations & cooldown calculation)
CREATE TABLE IF NOT EXISTS donations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  donor_id INT NOT NULL,
  request_id INT NULL,
  donation_date DATE NOT NULL,
  hospital_name VARCHAR(190) NOT NULL,
  units INT NOT NULL DEFAULT 1,
  blood_group ENUM('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+') NOT NULL,
  recipient_case VARCHAR(255) NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_donations_donor FOREIGN KEY (donor_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_donations_request FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE SET NULL,
  INDEX idx_donations_donor (donor_id, donation_date)
);

-- 2. Donor preferences & privacy settings columns in donor_profiles
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donor_profiles' AND COLUMN_NAME = 'phone_masked'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE donor_profiles ADD COLUMN phone_masked BOOLEAN NOT NULL DEFAULT TRUE',
  'SELECT ''phone_masked already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donor_profiles' AND COLUMN_NAME = 'auto_cooldown_lock'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE donor_profiles ADD COLUMN auto_cooldown_lock BOOLEAN NOT NULL DEFAULT TRUE',
  'SELECT ''auto_cooldown_lock already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donor_profiles' AND COLUMN_NAME = 'alert_radius'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE donor_profiles ADD COLUMN alert_radius INT NOT NULL DEFAULT 10',
  'SELECT ''alert_radius already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donor_profiles' AND COLUMN_NAME = 'notify_whatsapp'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE donor_profiles ADD COLUMN notify_whatsapp BOOLEAN NOT NULL DEFAULT TRUE',
  'SELECT ''notify_whatsapp already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donor_profiles' AND COLUMN_NAME = 'notify_sms'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE donor_profiles ADD COLUMN notify_sms BOOLEAN NOT NULL DEFAULT TRUE',
  'SELECT ''notify_sms already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donor_profiles' AND COLUMN_NAME = 'notify_inapp'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE donor_profiles ADD COLUMN notify_inapp BOOLEAN NOT NULL DEFAULT TRUE',
  'SELECT ''notify_inapp already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donor_profiles' AND COLUMN_NAME = 'preferred_language'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE donor_profiles ADD COLUMN preferred_language VARCHAR(10) NOT NULL DEFAULT ''en''',
  'SELECT ''preferred_language already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Request metadata columns (patient diagnosis, contact phone, slip notes)
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requests' AND COLUMN_NAME = 'patient_case'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE requests ADD COLUMN patient_case VARCHAR(255) NULL',
  'SELECT ''patient_case already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requests' AND COLUMN_NAME = 'contact_phone'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE requests ADD COLUMN contact_phone VARCHAR(50) NULL',
  'SELECT ''contact_phone already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requests' AND COLUMN_NAME = 'attendant_name'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE requests ADD COLUMN attendant_name VARCHAR(120) NULL',
  'SELECT ''attendant_name already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requests' AND COLUMN_NAME = 'prescription_slip'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE requests ADD COLUMN prescription_slip VARCHAR(255) NULL',
  'SELECT ''prescription_slip already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. User compliance column (suspension for abuse prevention)
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_suspended'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN is_suspended BOOLEAN NOT NULL DEFAULT FALSE',
  'SELECT ''is_suspended already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5. Fraud reports and rate-limiting queue
CREATE TABLE IF NOT EXISTS fraud_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reporter_id INT NULL,
  target_user_id INT NULL,
  target_request_id INT NULL,
  report_type ENUM('suspicious_request', 'unreachable_donor', 'fake_hospital', 'rate_limit_exceeded', 'other') NOT NULL,
  details TEXT NOT NULL,
  status ENUM('pending', 'investigating', 'resolved', 'dismissed') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_fraud_status (status)
);

-- 6. System policies table
CREATE TABLE IF NOT EXISTS system_policies (
  policy_key VARCHAR(100) PRIMARY KEY,
  policy_value VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Pre-seed system default policies
INSERT INTO system_policies (policy_key, policy_value)
VALUES
  ('cooldown_days', '90'),
  ('max_requests_per_day', '3'),
  ('sms_gateway_enabled', 'true'),
  ('allowed_zones', 'Sukkur IBA Area, Minara Road / Civil Hospital, Military Road / Cantonment, Rohri City, Pano Aqil')
ON DUPLICATE KEY UPDATE policy_value = VALUES(policy_value);
