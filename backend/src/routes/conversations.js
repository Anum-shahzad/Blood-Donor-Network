import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import {
  getOrCreateConversation,
  listMessages,
  sendMessage,
} from '../services/chatService.js';

const router = Router();

// Only donors and requesters ever take part in a conversation; admins are not
// participants. This is the coarse role gate — the real check (is this user
// the donor or requester of THIS conversation?) happens in chatService.js on
// every route, because holding the right role is not enough.
router.use(authenticate, authorize('donor', 'requester'));

function parseId(req, res, param) {
  const id = Number(req.params[param]);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: 'Invalid id' });
    return null;
  }
  return id;
}

// GET /api/conversations/:requestId — get-or-create the conversation for a
// request and donor (the caller, or ?donor_id= for the requester). 404 for anyone who isn't a party to it.
router.get('/:requestId', async (req, res, next) => {
  try {
    const requestId = parseId(req, res, 'requestId');
    if (requestId === null) return;

    // Requesters may name which committed donor's thread they want.
    let donorId = null;
    if (req.query.donor_id !== undefined) {
      donorId = Number(req.query.donor_id);
      if (!Number.isInteger(donorId) || donorId < 1) {
        return res.status(400).json({ error: 'Invalid donor_id' });
      }
    }

    const conversation = await getOrCreateConversation(req.user.id, requestId, donorId);
    res.json(conversation);
  } catch (err) {
    next(err);
  }
});

// GET /api/conversations/:id/messages — oldest first.
router.get('/:id/messages', async (req, res, next) => {
  try {
    const conversationId = parseId(req, res, 'id');
    if (conversationId === null) return;

    const result = await listMessages(conversationId, req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/conversations/:id/messages — body: { message }
router.post('/:id/messages', async (req, res, next) => {
  try {
    const conversationId = parseId(req, res, 'id');
    if (conversationId === null) return;

    // sender_id is always the authenticated user — never read from the body.
    const message = await sendMessage(conversationId, req.user.id, req.body?.message);
    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

export default router;
