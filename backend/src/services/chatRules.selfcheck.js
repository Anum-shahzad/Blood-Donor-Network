// Plain-Node correctness check for chat access + validation rules — no DB,
// no framework. Run with: npm run test:chat
import {
  isParticipant,
  canReadConversation,
  canSendMessage,
  isChatOpen,
  validateMessageBody,
  MESSAGE_MAX_LENGTH,
} from './chatRules.js';

let failures = 0;
const fail = (msg) => { console.log(`FAIL: ${msg}`); failures++; };
const pass = (msg) => console.log(`PASS: ${msg}`);
const check = (cond, okMsg, badMsg) => (cond ? pass(okMsg) : fail(badMsg));

const DONOR = 11;
const REQUESTER = 22;
const OTHER_DONOR = 33;     // a different donor — right role, wrong conversation
const OTHER_REQUESTER = 44; // a different requester
const ADMIN = 1;

const conversation = { id: 5, request_id: 9, donor_id: DONOR, requester_id: REQUESTER };
const openRequest = { id: 9, status: 'donor_accepted' };

// --- Access (the security-critical part) ---------------------------------

check(canReadConversation(conversation, DONOR).ok,
  'donor can access their own conversation',
  'donor was blocked from their own conversation');

check(canReadConversation(conversation, REQUESTER).ok,
  'requester can access their own conversation',
  'requester was blocked from their own conversation');

for (const [label, id] of [
  ['a different donor', OTHER_DONOR],
  ['a different requester', OTHER_REQUESTER],
  ['an admin', ADMIN],
]) {
  const r = canReadConversation(conversation, id);
  check(!r.ok && r.status === 404,
    `${label} cannot access it (404, not 403 — no probing)`,
    `${label} WRONGLY got access to someone else's conversation`);
}

check(!canReadConversation(null, DONOR).ok,
  'missing conversation is not readable',
  'missing conversation was treated as readable');

check(!canReadConversation(conversation, undefined).ok && !canReadConversation(conversation, null).ok,
  'an unauthenticated (undefined/null) user id never matches',
  'undefined/null user id WRONGLY matched a participant');

// JWT ids may be strings, DB ids numbers — must still match, and still not
// cross-match.
check(isParticipant(conversation, String(DONOR)) && isParticipant(conversation, String(REQUESTER)),
  'string ids ("11") match numeric DB ids',
  'string user id failed to match the numeric participant id');
check(!isParticipant(conversation, String(OTHER_DONOR)),
  'string id of a non-participant still does not match',
  'string id of a non-participant WRONGLY matched');

// A row with missing ids must not accidentally match undefined callers.
check(!isParticipant({ donor_id: null, requester_id: null }, undefined),
  'null participant ids never match an undefined caller',
  'null participant ids WRONGLY matched an undefined caller');

// --- Sending: participant AND chat open ---------------------------------

for (const id of [DONOR, REQUESTER]) {
  check(canSendMessage(conversation, openRequest, id).ok,
    `participant ${id} can send while request is donor_accepted`,
    `participant ${id} was blocked from sending on an open chat`);
}

for (const id of [OTHER_DONOR, OTHER_REQUESTER, ADMIN]) {
  const r = canSendMessage(conversation, openRequest, id);
  check(!r.ok && r.status === 404,
    `non-participant ${id} cannot send, even on an open chat`,
    `non-participant ${id} WRONGLY allowed to send`);
}

for (const status of ['pending', 'verified', 'matched', 'fulfilled', 'cancelled', 'expired']) {
  const r = canSendMessage(conversation, { id: 9, status }, DONOR);
  check(!r.ok && r.status === 409,
    `nobody can send once request status is ${status} (read-only)`,
    `sending WRONGLY allowed when request status is ${status}`);
  check(canReadConversation(conversation, DONOR).ok,
    `  ...but participants can still READ a ${status} conversation`,
    `  ...participant was blocked from READING a ${status} conversation`);
}

check(isChatOpen(openRequest) && !isChatOpen({ status: 'fulfilled' }) && !isChatOpen(null),
  'isChatOpen is true only for donor_accepted',
  'isChatOpen gave a wrong answer');

// --- Message validation ---------------------------------------------------

const ok = validateMessageBody('  On my way, 20 minutes  ');
check(ok.ok && ok.message === 'On my way, 20 minutes',
  'valid message is accepted and trimmed',
  'valid message was rejected or not trimmed');

for (const [label, value] of [
  ['empty string', ''],
  ['whitespace only', '   \n\t '],
  ['a number', 42],
  ['null', null],
  ['undefined', undefined],
  ['an object', { text: 'hi' }],
]) {
  check(!validateMessageBody(value).ok,
    `${label} is rejected`,
    `${label} was WRONGLY accepted as a message`);
}

check(validateMessageBody('a'.repeat(MESSAGE_MAX_LENGTH)).ok,
  `a message of exactly ${MESSAGE_MAX_LENGTH} chars is accepted`,
  `a message of exactly ${MESSAGE_MAX_LENGTH} chars was rejected`);
check(!validateMessageBody('a'.repeat(MESSAGE_MAX_LENGTH + 1)).ok,
  `a message of ${MESSAGE_MAX_LENGTH + 1} chars is rejected`,
  `an over-length message was WRONGLY accepted`);

console.log(failures === 0 ? '\nAll chat self-checks passed.' : `\n${failures} chat self-check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
