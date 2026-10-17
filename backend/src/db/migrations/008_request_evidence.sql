-- Phase 2: optional evidence on blood requests, with admin review.
-- Additive only: three new tables. No existing table or column is changed and
-- no existing row is touched. Safe to re-run (CREATE TABLE IF NOT EXISTS).
--
--   mysql -u <user> -p <database> < src/db/migrations/008_request_evidence.sql
--
-- Requires migrations 001-007 (it references users and requests).
--
-- Evidence review is deliberately SEPARATE from request verification:
-- nothing here reads or writes requests.is_verified or requests.status, so an
-- evidence decision can never verify, un-verify, cancel or re-open a request.
-- A request with no evidence at all is a normal request.
--
-- Document bytes live in request_evidence_files (MEDIUMBLOB), exactly like
-- Phase 1's verification_files: the hosts this project deploys to have an
-- ephemeral or read-only disk, and the database is the one private store the
-- deployment already has. There is no public URL for any file; the API streams
-- it after an authorization check.

CREATE TABLE IF NOT EXISTS request_evidence_submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  -- pending            : waiting for an admin
  -- approved           : an admin accepted the evidence
  -- rejected           : an admin did not accept it (reason shown to requester)
  -- more_info          : an admin asked for more information (message shown)
  status ENUM('pending', 'approved', 'rejected', 'more_info') NOT NULL DEFAULT 'pending',
  -- Optional free-text note from the requester about what they attached.
  requester_note VARCHAR(500) NULL,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Current decision. The full decision trail is in request_evidence_reviews.
  reviewed_by INT NULL,
  reviewed_at DATETIME NULL,
  -- Shown to the requester for rejected / more_info.
  decision_reason VARCHAR(500) NULL,
  -- Admin-only. Never returned by any requester-facing endpoint.
  internal_note VARCHAR(500) NULL,
  CONSTRAINT fk_req_evid_request
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_req_evid_reviewer
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_req_evid_request (request_id, id),
  INDEX idx_req_evid_queue (status, submitted_at)
);

CREATE TABLE IF NOT EXISTS request_evidence_files (
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
  CONSTRAINT fk_req_evid_file_submission
    FOREIGN KEY (submission_id) REFERENCES request_evidence_submissions(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_req_evid_file_key (storage_key),
  INDEX idx_req_evid_file_submission (submission_id)
);

-- Append-only audit trail: one row per admin decision, including changes to an
-- earlier decision. Survives the admin account being deleted (admin_id is set
-- to NULL, the decision itself is kept).
CREATE TABLE IF NOT EXISTS request_evidence_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  submission_id INT NOT NULL,
  admin_id INT NULL,
  decision ENUM('approved', 'rejected', 'more_info') NOT NULL,
  reason VARCHAR(500) NULL,
  internal_note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_req_evid_review_submission
    FOREIGN KEY (submission_id) REFERENCES request_evidence_submissions(id) ON DELETE CASCADE,
  CONSTRAINT fk_req_evid_review_admin
    FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_req_evid_review_submission (submission_id, id)
);
