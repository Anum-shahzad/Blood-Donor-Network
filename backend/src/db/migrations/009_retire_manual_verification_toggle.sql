-- Retire the manual "Verify Group" admin toggle.
--
--   mysql -u <user> -p <database> < src/db/migrations/009_retire_manual_verification_toggle.sql
--
-- donor_profiles.is_blood_group_verified was set by a plain admin toggle with
-- no evidence behind it. The application no longer reads or writes it: every
-- badge is derived from verification_submissions (migration 007). This script
-- makes the stored data match:
--
--   1. Copies each donor whose toggle was ON into an audit table, so admins can
--      still see who used to be marked and ask them to submit real evidence.
--      The old value is NOT proof of anything and is never used for a badge.
--   2. Resets the column to FALSE.
--
-- Additive and safe to re-run: the audit table is created if missing, a donor
-- is archived only once, and re-running only resets rows that are still TRUE.
-- No donor profile, user, submission or file row is deleted.

CREATE TABLE IF NOT EXISTS legacy_manual_verification (
  user_id INT PRIMARY KEY,
  previous_value BOOLEAN NOT NULL,
  archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_legacy_manual_verif_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT IGNORE INTO legacy_manual_verification (user_id, previous_value)
SELECT user_id, TRUE FROM donor_profiles WHERE is_blood_group_verified = TRUE;

UPDATE donor_profiles SET is_blood_group_verified = FALSE WHERE is_blood_group_verified = TRUE;
