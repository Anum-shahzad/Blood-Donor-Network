// Conversation + message persistence. The access rules themselves live in
// chatRules.js (pure); this file loads the rows, applies those rules, and
// does the writes.
//
// Chat never touches donor_profiles or requests — it only reads them to
// decide who the participants are and whether the thread is still open.
import { pool } from '../config/db.js';
import {
  isParticipant,
  isChatOpen,
  canReadConversation,
  canSendMessage,
  validateMessageBody,
} from './chatRules.js';

// Most recent messages returned per poll. A coordination thread for one
// blood request never gets near this; the cap only exists so a runaway
// thread can't make every 5-second poll huge.
const MESSAGE_LIST_LIMIT = 500;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Creates the conversation for a request, or makes sure it points at the
// donor who currently holds the commitment. Called with an open transaction
// connection from acceptRequest() (so the conversation exists the moment the
// accept commits) and from getOrCreateConversation() (to backfill requests
// that were accepted before chat existed).
//
// If a conversation already exists for this request with a DIFFERENT donor
// (the earlier donor cancelled, someone new accepted), the row is re-pointed
// at the new donor and the old messages are deleted. The alternative — leaving
// them — would let the new donor read the requester's private conversation
// with someone else, including anything like phone numbers they exchanged.
// Same donor re-accepting keeps their history.
export async function upsertConversation(conn, { requestId, donorId, requesterId }) {
  await conn.query(
    `INSERT INTO conversations (request_id, donor_id, requester_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE request_id = request_id`,
    [requestId, donorId, requesterId]
  );

  const [rows] = await conn.query(
    'SELECT * FROM conversations WHERE request_id = ? FOR UPDATE',
    [requestId]
  );
  const conversation = rows[0];

  if (Number(conversation.donor_id) !== Number(donorId)) {
    await conn.query('DELETE FROM messages WHERE conversation_id = ?', [conversation.id]);
    await conn.query(
      'UPDATE conversations SET donor_id = ?, created_at = NOW() WHERE id = ?',
      [donorId, conversation.id]
    );
    conversation.donor_id = donorId;
  }

  return conversation;
}

async function runInTransaction(work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// What the frontend needs to render a thread header without a second call.
// Deliberately only a name for the other party — no email/phone. If the two
// want to share contact details, that is their choice inside the chat.
async function describeConversation(conversation, request, userId) {
  const counterpartId = isSameUser(conversation.donor_id, userId)
    ? conversation.requester_id
    : conversation.donor_id;
  const counterpartRole = isSameUser(conversation.donor_id, userId) ? 'requester' : 'donor';

  const [userRows] = await pool.query('SELECT id, name FROM users WHERE id = ?', [counterpartId]);

  return {
    id: conversation.id,
    request_id: conversation.request_id,
    donor_id: conversation.donor_id,
    requester_id: conversation.requester_id,
    chat_open: isChatOpen(request),
    request: {
      id: request.id,
      blood_group: request.blood_group,
      hospital_name: request.hospital_name,
      city: request.city,
      status: request.status,
    },
    counterpart: {
      id: counterpartId,
      name: userRows[0]?.name || 'Unknown user',
      role: counterpartRole,
    },
  };
}

function isSameUser(a, b) {
  return Number(a) === Number(b);
}

// GET /api/conversations/:requestId
//
// Get-or-create. The conversation is normally created inside acceptRequest();
// creating it here as well covers requests that were accepted before chat
// shipped, and re-syncs the thread if the committed donor ever differs from
// the one on the row. Only a party to the conversation can trigger creation.
export async function getOrCreateConversation(userId, requestId) {
  const [requestRows] = await pool.query(
    'SELECT id, requester_id, status, blood_group, hospital_name, city FROM requests WHERE id = ?',
    [requestId]
  );
  const request = requestRows[0];
  if (!request) {
    throw httpError(404, 'Conversation not found');
  }

  const [existingRows] = await pool.query('SELECT * FROM conversations WHERE request_id = ?', [requestId]);
  let conversation = existingRows[0];

  if (request.status === 'donor_accepted') {
    const [committedRows] = await pool.query(
      'SELECT user_id FROM donor_profiles WHERE committed_request_id = ? LIMIT 1',
      [requestId]
    );
    const committedDonorId = committedRows[0]?.user_id;

    const needsSync =
      committedDonorId && (!conversation || !isSameUser(conversation.donor_id, committedDonorId));

    // Only someone who would be a participant of the resulting conversation
    // may cause it to be created — anyone else falls through to the 404.
    const wouldBe = { donor_id: committedDonorId, requester_id: request.requester_id };
    if (needsSync && isParticipant(wouldBe, userId)) {
      conversation = await runInTransaction((conn) =>
        upsertConversation(conn, {
          requestId,
          donorId: committedDonorId,
          requesterId: request.requester_id,
        })
      );
    }
  }

  // Same 404 whether there is no conversation yet or it belongs to someone
  // else — no probing which requests have chats.
  const access = canReadConversation(conversation, userId);
  if (!access.ok) {
    throw httpError(access.status, access.reason);
  }

  return describeConversation(conversation, request, userId);
}

// Loads a conversation by its own id and confirms the user is a party to it.
// Returns { conversation, request }. Every messages endpoint goes through here.
async function loadForParticipant(conversationId, userId) {
  const [convRows] = await pool.query('SELECT * FROM conversations WHERE id = ?', [conversationId]);
  const conversation = convRows[0];

  const access = canReadConversation(conversation, userId);
  if (!access.ok) {
    throw httpError(access.status, access.reason);
  }

  const [requestRows] = await pool.query('SELECT id, status FROM requests WHERE id = ?', [
    conversation.request_id,
  ]);

  return { conversation, request: requestRows[0] };
}

// GET /api/conversations/:id/messages — oldest first.
export async function listMessages(conversationId, userId) {
  const { conversation, request } = await loadForParticipant(conversationId, userId);

  const [rows] = await pool.query(
    `SELECT id, sender_id, message, created_at FROM (
       SELECT id, sender_id, message, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY id DESC
       LIMIT ?
     ) recent
     ORDER BY id ASC`,
    [conversation.id, MESSAGE_LIST_LIMIT]
  );

  // chat_open rides along so a thread that closes while someone has it open
  // (requester marks fulfilled, donor cancels) flips to read-only on the next
  // poll without the frontend needing a separate status call.
  return { conversation_id: conversation.id, chat_open: isChatOpen(request), messages: rows };
}

// POST /api/conversations/:id/messages
export async function sendMessage(conversationId, userId, rawMessage) {
  // Participant check first, so a stranger gets the same 404 whether or not
  // their message body was valid.
  const { conversation, request } = await loadForParticipant(conversationId, userId);

  const body = validateMessageBody(rawMessage);
  if (!body.ok) {
    throw httpError(400, body.reason);
  }

  const allowed = canSendMessage(conversation, request, userId);
  if (!allowed.ok) {
    throw httpError(allowed.status, allowed.reason);
  }

  const [result] = await pool.query(
    'INSERT INTO messages (conversation_id, sender_id, message) VALUES (?, ?, ?)',
    [conversation.id, userId, body.message]
  );

  const [rows] = await pool.query(
    'SELECT id, sender_id, message, created_at FROM messages WHERE id = ?',
    [result.insertId]
  );
  return rows[0];
}
