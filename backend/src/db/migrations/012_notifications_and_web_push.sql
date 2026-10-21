-- Urgent-alert notifications: in-app feed, browser notifications and Web Push.
--
--   mysql -u <user> -p <database> < src/db/migrations/012_notifications_and_web_push.sql
--
-- Additive and safe to re-run. Nothing existing is altered except two new
-- opt-out flags on donor_profiles (both default ON; Web Push additionally
-- requires the donor to explicitly subscribe a browser, and browser
-- notifications require the donor to grant browser permission).
--
-- notifications        one row per (kind, request, donor). The unique dedupe_key
--                      makes a repeated alert, a retry or a double click
--                      impossible to turn into a second notification.
--                      channel_* record which channels the donor's preferences
--                      allowed AT CREATION TIME.
--                      read_at = dismissed/seen, acknowledged_at = donor acted on it
--                      (opened the request or answered it).
-- push_subscriptions   one row per browser/device. endpoint_hash is the unique key.
-- push_deliveries      one row per (notification, subscription) send. status
--                      'accepted' only means the push service (FCM/Mozilla/Apple)
--                      accepted the message. It does NOT mean the donor saw it.

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(40) NOT NULL DEFAULT 'urgent_alert',
  request_id INT NULL,
  dedupe_key VARCHAR(120) NOT NULL,
  channel_inapp BOOLEAN NOT NULL DEFAULT TRUE,
  channel_browser BOOLEAN NOT NULL DEFAULT TRUE,
  channel_push BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP NULL,
  acknowledged_at TIMESTAMP NULL,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_request FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_notifications_dedupe (dedupe_key),
  INDEX idx_notifications_user_unread (user_id, read_at, created_at)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  endpoint_hash CHAR(64) NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_success_at TIMESTAMP NULL,
  last_failure_at TIMESTAMP NULL,
  failure_count INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_push_subscriptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_push_endpoint (endpoint_hash),
  INDEX idx_push_subscriptions_user (user_id)
);

CREATE TABLE IF NOT EXISTS push_deliveries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  notification_id INT NOT NULL,
  subscription_id INT NULL,
  status ENUM('accepted', 'failed', 'expired') NOT NULL,
  attempts INT NOT NULL DEFAULT 1,
  http_status INT NULL,
  error VARCHAR(255) NULL,
  attempted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_push_deliveries_notification FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
  CONSTRAINT fk_push_deliveries_subscription FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE SET NULL,
  INDEX idx_push_deliveries_notification (notification_id)
);

-- Per-donor channel switches. Browser notifications and Web Push still need
-- the donor's explicit opt-in on their device; these just let them mute a channel.
SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donor_profiles' AND COLUMN_NAME = 'notify_browser');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE donor_profiles ADD COLUMN notify_browser BOOLEAN NOT NULL DEFAULT TRUE',
  'SELECT ''notify_browser already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'donor_profiles' AND COLUMN_NAME = 'notify_push');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE donor_profiles ADD COLUMN notify_push BOOLEAN NOT NULL DEFAULT TRUE',
  'SELECT ''notify_push already exists''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
