-- Feature 1 (Final Feature Spec, Section 3): private request-specific chat.
--
-- Additive only — creates two new tables and touches nothing that exists.
-- Safe to re-run (CREATE TABLE IF NOT EXISTS). Apply once per database:
--
--   mysql -u <user> -p <database> < src/db/migrations/002_chat.sql
--
-- Requires 001_phase1_donor_state_and_commitment.sql to have been applied
-- first (chat is only opened for requests in the 'donor_accepted' status).

-- One conversation per request (uniq_request_conversation). If the committed
-- donor cancels and a different donor later accepts, the SAME row is
-- re-pointed at the new donor and its old messages are cleared — see
-- upsertConversation() in services/chatService.js for why.
CREATE TABLE IF NOT EXISTS conversations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  donor_id INT NOT NULL,
  requester_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_request_conversation (request_id),
  CONSTRAINT fk_conv_request FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_conv_donor FOREIGN KEY (donor_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_conv_requester FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  sender_id INT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_msg_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  INDEX idx_messages_conversation (conversation_id, created_at)
);
