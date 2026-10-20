-- Multi-donor, multi-unit fulfilment.
--
-- A request needing several units can now be accepted by several donors. Each
-- donor's commitment (units promised) and confirmed donation (units actually
-- donated) are tracked separately on request_responses, and a request is only
-- 'fulfilled' once the confirmed units reach units_needed.
--
-- Additive and re-runnable. Run once against an existing database:
--
--   mysql -u <user> -p <database> < src/db/migrations/010_multi_unit_fulfillment.sql

-- 1. Response states: 'donated' (confirmed donation), 'failed' (donation was
--    unsuccessful or the donor did not show) and 'cancelled' (donor withdrew
--    or the request was closed). Restating the full ENUM list is required.
ALTER TABLE request_responses
  MODIFY status ENUM('notified', 'accepted', 'declined', 'donated', 'failed', 'cancelled')
  NOT NULL DEFAULT 'notified';

-- 2. Units this donor promised, and units actually donated.
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'request_responses' AND COLUMN_NAME = 'committed_units'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE request_responses ADD COLUMN committed_units INT NOT NULL DEFAULT 1',
  'SELECT ''committed_units already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'request_responses' AND COLUMN_NAME = 'confirmed_units'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE request_responses ADD COLUMN confirmed_units INT NOT NULL DEFAULT 0',
  'SELECT ''confirmed_units already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Backfill: before this change a recorded donation left the response as
--    'accepted'. Turn those into 'donated' with the units actually recorded.
UPDATE request_responses rr
  JOIN donations d ON d.request_id = rr.request_id AND d.donor_id = rr.donor_id
   SET rr.status = 'donated',
       rr.confirmed_units = d.units,
       rr.committed_units = GREATEST(rr.committed_units, d.units)
 WHERE rr.status = 'accepted';

-- 4. Index for the per-request unit totals that every accept / donation reads.
SET @idx_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'request_responses' AND INDEX_NAME = 'idx_responses_request_status'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE request_responses ADD INDEX idx_responses_request_status (request_id, status)',
  'SELECT ''idx_responses_request_status already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5. Chat: one private thread per donor on a request (was one per request).
--    The new key is added BEFORE the old one is dropped because the request_id
--    foreign key needs an index that starts with request_id at all times.
SET @idx_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversations' AND INDEX_NAME = 'uniq_request_donor_conversation'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE conversations ADD UNIQUE KEY uniq_request_donor_conversation (request_id, donor_id)',
  'SELECT ''uniq_request_donor_conversation already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversations' AND INDEX_NAME = 'uniq_request_conversation'
);
SET @sql := IF(@idx_exists > 0,
  'ALTER TABLE conversations DROP INDEX uniq_request_conversation',
  'SELECT ''uniq_request_conversation already dropped'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
