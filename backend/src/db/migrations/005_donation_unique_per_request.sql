-- Donation-record integrity: at most one donation record per donor per request.
--
-- OPTIONAL hardening. The application already enforces this under a row lock
-- (services/donorCommitment.js -> recordDonation), so the app works with or
-- without this migration. The index just makes the database refuse duplicates
-- even if some future code path forgets to check.
--
-- Additive and non-destructive: no rows are changed or deleted. If duplicate
-- (donor_id, request_id) rows already exist the index is NOT created and a
-- message tells you so — clean those up by hand, then re-run. Rows with
-- request_id NULL (history entries) are never affected; MySQL allows many
-- NULLs under a unique index.
--
--   mysql -u <user> -p <database> < src/db/migrations/005_donation_unique_per_request.sql
--
-- Safe to re-run.

SET @idx_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donations' AND INDEX_NAME = 'uniq_donation_donor_request'
);
SET @dupes := (
  SELECT COUNT(*) FROM (
    SELECT donor_id, request_id FROM donations
    WHERE request_id IS NOT NULL
    GROUP BY donor_id, request_id HAVING COUNT(*) > 1
  ) d
);
SET @sql := IF(@idx_exists > 0,
  'SELECT ''uniq_donation_donor_request already exists''',
  IF(@dupes > 0,
    'SELECT ''SKIPPED: duplicate donations exist for the same donor and request - review them, then re-run''',
    'ALTER TABLE donations ADD UNIQUE KEY uniq_donation_donor_request (donor_id, request_id)'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
