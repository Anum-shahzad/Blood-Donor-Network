-- Phase 1: donor operational states + commitment locking + request lifecycle.
--
-- Additive only — nothing here drops or renames an existing column, so the
-- app keeps running on the old schema.sql shape until this is applied, and
-- keeps running after. Run this once against an existing database:
--
--   mysql -u <user> -p <database> < src/db/migrations/001_phase1_donor_state_and_commitment.sql
--
-- Safe to re-run: every statement is guarded (INFORMATION_SCHEMA checks for
-- columns/keys that don't support "IF NOT EXISTS" in this MySQL version).

-- 1. Donor operational state, separate from account status (there is no
--    account-suspension column yet — that is Phase 3 — so today AVAILABLE
--    is the only value account status would ever gate).
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donor_profiles' AND COLUMN_NAME = 'current_status'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE donor_profiles
     ADD COLUMN current_status ENUM(
       ''AVAILABLE'', ''MATCHED'', ''COMMITTED'', ''EN_ROUTE'', ''ARRIVED'',
       ''DONATING'', ''DONATION_COMPLETED'', ''COOLDOWN''
     ) NOT NULL DEFAULT ''AVAILABLE'' AFTER is_available',
  'SELECT ''current_status already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donor_profiles' AND COLUMN_NAME = 'status_changed_at'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE donor_profiles ADD COLUMN status_changed_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP',
  'SELECT ''status_changed_at already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Commitment linkage — which request (if any) currently owns this donor.
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donor_profiles' AND COLUMN_NAME = 'committed_request_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE donor_profiles ADD COLUMN committed_request_id INT NULL',
  'SELECT ''committed_request_id already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donor_profiles' AND COLUMN_NAME = 'commitment_started_at'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE donor_profiles ADD COLUMN commitment_started_at TIMESTAMP NULL',
  'SELECT ''commitment_started_at already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donor_profiles' AND COLUMN_NAME = 'commitment_ended_at'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE donor_profiles ADD COLUMN commitment_ended_at TIMESTAMP NULL',
  'SELECT ''commitment_ended_at already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. cooldown_until is added now (schema-complete for the whole donor
--    lifecycle) even though nothing sets it until the Phase 4 donation-
--    confirmation work lands.
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donor_profiles' AND COLUMN_NAME = 'cooldown_until'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE donor_profiles ADD COLUMN cooldown_until DATETIME NULL',
  'SELECT ''cooldown_until already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. FK + index for the commitment link. Added only if missing, and only
--    after the column exists (see above).
SET @fk_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donor_profiles' AND CONSTRAINT_NAME = 'fk_donor_profiles_committed_request'
);
SET @sql := IF(@fk_exists = 0,
  'ALTER TABLE donor_profiles
     ADD CONSTRAINT fk_donor_profiles_committed_request
     FOREIGN KEY (committed_request_id) REFERENCES requests(id) ON DELETE SET NULL',
  'SELECT ''fk_donor_profiles_committed_request already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donor_profiles' AND INDEX_NAME = 'idx_donor_state_matching'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE donor_profiles ADD INDEX idx_donor_state_matching (current_status, is_available, blood_group)',
  'SELECT ''idx_donor_state_matching already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5. Request lifecycle: insert 'donor_accepted' between 'matched' and
--    'fulfilled'. MySQL ENUM changes require restating the full list.
ALTER TABLE requests
  MODIFY status ENUM('pending', 'verified', 'matched', 'donor_accepted', 'fulfilled', 'expired', 'cancelled')
  NOT NULL DEFAULT 'pending';

-- 6. request_responses: 'declined' already existed, but decline previously
--    had no server-enforced timing guarantee. No structural change needed
--    here — responded_at already covers it. Just confirming the unique key
--    used for the accept/decline upsert still exists.
SET @key_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'request_responses' AND INDEX_NAME = 'uniq_request_donor'
);
SET @sql := IF(@key_exists = 0,
  'ALTER TABLE request_responses ADD UNIQUE KEY uniq_request_donor (request_id, donor_id)',
  'SELECT ''uniq_request_donor already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
