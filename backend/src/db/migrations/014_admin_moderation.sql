-- Admin moderation workflow: decisions on reports, private investigation notes,
-- temporary / permanent suspensions with a reason, and account notices.
--
--   mysql -u <user> -p <database> < src/db/migrations/014_admin_moderation.sql
--
-- Additive and safe to re-run. Nothing is dropped; no existing row is changed.
--
-- users.is_suspended stays the single flag every existing check already reads.
-- The new columns only describe the suspension (why, by whom, until when).
--   suspended_until IS NULL while is_suspended = TRUE  -> permanent suspension
--   suspended_until in the future                      -> temporary suspension
--   suspended_until in the past                        -> expired; the backend
--                                                         lifts the flag itself
--
-- moderation_actions     what was decided and WHY. For a warning or suspension the
--                        reason is shown to the affected user, so it never holds
--                        private notes. For a dismissal it is the admin's internal
--                        rationale and is not shown to anyone but admins. One row
--                        per warning / suspension / reinstatement / dismissal /
--                        automatic expiry.
-- report_admin_notes     PRIVATE investigation notes. Only /api/admin routes ever
--                        read this table; nothing user-facing joins it.
-- notifications.title/body  text for account notices (type 'account_notice'),
--                        which reuse the existing notifications table.

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'suspended_until');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN suspended_until DATETIME NULL',
  'SELECT ''users.suspended_until already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'suspension_reason');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN suspension_reason VARCHAR(500) NULL',
  'SELECT ''users.suspension_reason already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'suspended_at');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN suspended_at DATETIME NULL',
  'SELECT ''users.suspended_at already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'suspended_by');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN suspended_by INT NULL',
  'SELECT ''users.suspended_by already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'title');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE notifications ADD COLUMN title VARCHAR(190) NULL',
  'SELECT ''notifications.title already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'body');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE notifications ADD COLUMN body TEXT NULL',
  'SELECT ''notifications.body already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS moderation_actions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  report_id INT NULL,
  target_user_id INT NULL,
  admin_id INT NULL,
  action ENUM('warning', 'suspension', 'reinstatement', 'dismissal', 'suspension_expired') NOT NULL,
  reason TEXT NOT NULL,
  is_permanent BOOLEAN NOT NULL DEFAULT FALSE,
  suspended_until DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mod_actions_user FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mod_actions_report FOREIGN KEY (report_id) REFERENCES fraud_reports(id) ON DELETE SET NULL,
  INDEX idx_mod_actions_user (target_user_id, id),
  INDEX idx_mod_actions_report (report_id, id)
);

CREATE TABLE IF NOT EXISTS report_admin_notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  report_id INT NOT NULL,
  admin_id INT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_report_notes_report FOREIGN KEY (report_id) REFERENCES fraud_reports(id) ON DELETE CASCADE,
  INDEX idx_report_notes_report (report_id, id)
);
