// Chat access and validation rules — pure decision logic, no DB access.
// Same split as matching/donorState.js vs donorCommitment.js: the rules live
// here so they can be checked with plain objects, and chatService.js is only
// the DB wrapper that applies them.
//
// Chat is coordination only. Nothing in this file (or anywhere in chat) reads
// or changes donor state or request status.

export const MESSAGE_MAX_LENGTH = 1000;

// Messages can only be SENT while the request has an accepted donor on it.
// Once the request moves on (fulfilled, cancelled, expired) or the donor backs
// out and the request reopens ('matched'), the thread stays readable to its
// participants but goes read-only — otherwise a donor who cancelled could keep
// messaging the requester of a request they are no longer part of.
export const CHAT_OPEN_REQUEST_STATUSES = ['donor_accepted'];

// JWT ids and DB ids can arrive as number or string depending on the layer,
// so compare numerically rather than with ===.
function sameId(a, b) {
  return a != null && b != null && Number(a) === Number(b);
}

// The one check that actually matters for chat security: only the
// conversation's own donor and requester are participants. Role alone is
// never enough (a different donor is still "a donor"), and admins are not
// participants either.
export function isParticipant(conversation, userId) {
  if (!conversation) return false;
  return sameId(conversation.donor_id, userId) || sameId(conversation.requester_id, userId);
}

// Reading. A non-participant is told "not found" rather than "forbidden" so
// the endpoint can't be used to probe which conversations exist.
export function canReadConversation(conversation, userId) {
  if (!conversation || !isParticipant(conversation, userId)) {
    return { ok: false, status: 404, reason: 'Conversation not found' };
  }
  return { ok: true };
}

// Whether the thread currently accepts new messages (independent of who is
// asking) — the frontend uses this to show or hide the input box.
export function isChatOpen(request) {
  return Boolean(request) && CHAT_OPEN_REQUEST_STATUSES.includes(request.status);
}

// Writing: participant AND chat still open.
export function canSendMessage(conversation, request, userId) {
  const read = canReadConversation(conversation, userId);
  if (!read.ok) return read;

  if (!isChatOpen(request)) {
    return {
      ok: false,
      status: 409,
      reason: 'This conversation is closed — the request no longer has an accepted donor',
    };
  }
  return { ok: true };
}

// Returns { ok: true, message } with the trimmed text, or { ok: false, reason }.
export function validateMessageBody(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'message must be text' };
  }
  const message = raw.trim();
  if (message.length === 0) {
    return { ok: false, reason: 'message cannot be empty' };
  }
  if (message.length > MESSAGE_MAX_LENGTH) {
    return { ok: false, reason: `message cannot be longer than ${MESSAGE_MAX_LENGTH} characters` };
  }
  return { ok: true, message };
}
