-- S-04 data repair: older versions of "un-verify" cleared is_verified but left
-- the request in an open status ('verified' / 'matched'), so the flag and the
-- lifecycle status disagreed. This moves those requests back to 'pending'
-- (the admin review queue) so they agree.
--
-- OPTIONAL: the backend now refuses to accept any request with
-- is_verified = FALSE regardless of status, so the app is safe without this;
-- it only tidies existing rows. It changes the status of affected requests
-- only — nothing is deleted and no columns change. Safe to re-run.
--
--   mysql -u <user> -p <database> < src/db/migrations/006_repair_unverified_open_requests.sql

UPDATE requests
   SET status = 'pending'
 WHERE is_verified = FALSE
   AND status IN ('verified', 'matched');
