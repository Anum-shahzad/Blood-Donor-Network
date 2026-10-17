-- Phase 1: staged identity / donation-evidence verification with private
-- document storage. Additive only: two new tables, no existing table or column
-- is changed. Safe to re-run (CREATE TABLE IF NOT EXISTS).
--
--   mysql -u <user> -p <database> < src/db/migrations/007_verification_submissions.sql
--
-- Nothing here stores a "level". A donor's verification level is derived at
-- read time from these rows plus users.is_suspended and fraud_reports, so it
-- can never be set by the user and revocations take effect immediately.
--
-- Document bytes live in verification_files (MEDIUMBLOB, max 16 MB; the API
-- caps uploads at 5 MB). They are kept in the database on purpose: the backend
-- runs on Railway / Vercel, where the local disk is ephemeral or read-only, and
-- the database is the one private store the deployment already has. There is no
-- public URL for any file; the API streams it after an authorization check.

CREATE TABLE IF NOT EXISTS verification_submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type ENUM('identity', 'donation_evidence') NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'revoked') NOT NULL DEFAULT 'pending',
  -- donation_evidence only: what the donor says the document shows.
  donation_date DATE NULL,
  facility_name VARCHAR(190) NULL,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Approval / rejection decision.
  reviewed_by INT NULL,
  reviewed_at DATETIME NULL,
  decision_reason VARCHAR(500) NULL,
  -- Revocation of a previously approved submission.
  revoked_by INT NULL,
  revoked_at DATETIME NULL,
  revocation_reason VARCHAR(500) NULL,
  CONSTRAINT fk_verif_sub_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_verif_sub_reviewer
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_verif_sub_revoker
    FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_verif_sub_user_type (user_id, type, id),
  INDEX idx_verif_sub_queue (status, type, submitted_at)
);

CREATE TABLE IF NOT EXISTS verification_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  submission_id INT NOT NULL,
  -- Random server-generated filename (48 hex chars + extension). The
  -- client's own filename is never stored or used.
  storage_key VARCHAR(64) NOT NULL,
  -- Detected from the file's signature, never taken from the client.
  content_type VARCHAR(50) NOT NULL,
  size_bytes INT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  data MEDIUMBLOB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_verif_file_submission
    FOREIGN KEY (submission_id) REFERENCES verification_submissions(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_verif_file_key (storage_key),
  INDEX idx_verif_file_submission (submission_id)
);
