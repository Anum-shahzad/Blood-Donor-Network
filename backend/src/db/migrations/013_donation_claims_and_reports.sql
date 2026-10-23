-- Donation claims that need requester confirmation + "Report a Problem".
--
-- Before this, a donor pressing "Mark as Donated" immediately recorded the
-- donation, fulfilled the request and started their cooldown. Now the donor
-- only CLAIMS a donation; it counts once the requester confirms it.
--
--   mysql -u <user> -p <database> < src/db/migrations/013_donation_claims_and_reports.sql
--
-- Additive and safe to re-run. Nothing is dropped; no existing row is changed.
--
-- request_responses.status
--   'claimed'   donor says they donated; waiting for the requester. Units stay
--               held (not donated, not available to other donors).
--   'disputed'  requester answered "Did Not Happen". Never counted as donated;
--               the claim details are kept for review.
-- The claim details live on the same row (one row per donor per request), so
-- nothing is written to `donations` until the requester confirms.
--
-- fraud_reports (existing moderation table) gains the report type
-- 'donation_dispute', the donor the report is about, and reviewer columns.
-- fraud_report_events is the audit trail: one row for the report being filed
-- and one for every admin status change.

ALTER TABLE request_responses
  MODIFY status ENUM('notified', 'accepted', 'declined', 'donated', 'failed', 'cancelled', 'claimed', 'disputed')
  NOT NULL DEFAULT 'notified';

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'request_responses' AND COLUMN_NAME = 'claimed_at');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE request_responses ADD COLUMN claimed_at DATETIME NULL',
  'SELECT ''request_responses.claimed_at already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'request_responses' AND COLUMN_NAME = 'claim_donation_date');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE request_responses ADD COLUMN claim_donation_date DATE NULL',
  'SELECT ''request_responses.claim_donation_date already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'request_responses' AND COLUMN_NAME = 'claim_hospital_name');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE request_responses ADD COLUMN claim_hospital_name VARCHAR(190) NULL',
  'SELECT ''request_responses.claim_hospital_name already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'request_responses' AND COLUMN_NAME = 'claim_recipient_case');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE request_responses ADD COLUMN claim_recipient_case VARCHAR(255) NULL',
  'SELECT ''request_responses.claim_recipient_case already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'request_responses' AND COLUMN_NAME = 'claim_units');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE request_responses ADD COLUMN claim_units INT NULL',
  'SELECT ''request_responses.claim_units already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'request_responses' AND COLUMN_NAME = 'claim_resolved_at');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE request_responses ADD COLUMN claim_resolved_at DATETIME NULL',
  'SELECT ''request_responses.claim_resolved_at already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE fraud_reports
  MODIFY report_type ENUM('suspicious_request', 'unreachable_donor', 'fake_hospital', 'rate_limit_exceeded', 'other', 'donation_dispute') NOT NULL;

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fraud_reports' AND COLUMN_NAME = 'related_donor_id');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE fraud_reports ADD COLUMN related_donor_id INT NULL',
  'SELECT ''fraud_reports.related_donor_id already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fraud_reports' AND COLUMN_NAME = 'reviewed_by');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE fraud_reports ADD COLUMN reviewed_by INT NULL',
  'SELECT ''fraud_reports.reviewed_by already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fraud_reports' AND COLUMN_NAME = 'reviewed_at');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE fraud_reports ADD COLUMN reviewed_at DATETIME NULL',
  'SELECT ''fraud_reports.reviewed_at already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fraud_reports' AND COLUMN_NAME = 'admin_note');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE fraud_reports ADD COLUMN admin_note TEXT NULL',
  'SELECT ''fraud_reports.admin_note already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS fraud_report_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  report_id INT NOT NULL,
  actor_id INT NULL,
  action VARCHAR(40) NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status VARCHAR(20) NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fraud_events_report FOREIGN KEY (report_id) REFERENCES fraud_reports(id) ON DELETE CASCADE,
  INDEX idx_fraud_events_report (report_id, id)
);
