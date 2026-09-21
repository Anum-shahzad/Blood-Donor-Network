import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../api/client.js';

// Spec: poll every 5-10 seconds, no WebSockets.
const POLL_INTERVAL_MS = 7000;
const MESSAGE_MAX_LENGTH = 1000; // mirrors MESSAGE_MAX_LENGTH in backend chatRules.js

function formatTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Private donor <-> requester thread for one request. Everything shown here
// comes from the backend — the access check (are you a party to this
// conversation?) is enforced server-side; this component just renders what
// the API allows.
export default function ChatPanel({ requestId, currentUserId, onClose }) {
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatOpen, setChatOpen] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pollError, setPollError] = useState('');
  const [sendError, setSendError] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const listRef = useRef(null);
  const stickToBottomRef = useRef(true);
  // Only the most recently *issued* fetch may update state, so a slow poll
  // that started before a send can't overwrite the list with a copy that
  // doesn't contain the message just sent.
  const fetchSeqRef = useRef(0);

  // 1. Get-or-create the conversation for this request.
  useEffect(() => {
    let cancelled = false;
    setConversation(null);
    setMessages([]);
    setLoadError('');

    apiGet(`/api/conversations/${requestId}`)
      .then((data) => {
        if (cancelled) return;
        setConversation(data);
        setChatOpen(data.chat_open);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const conversationId = conversation?.id;

  const loadMessages = useCallback(async () => {
    if (!conversationId) return;
    const seq = ++fetchSeqRef.current;
    try {
      const data = await apiGet(`/api/conversations/${conversationId}/messages`);
      if (seq !== fetchSeqRef.current) return; // a newer fetch has been issued
      setMessages(data.messages);
      setChatOpen(data.chat_open);
      setPollError('');
    } catch (err) {
      if (seq === fetchSeqRef.current) setPollError(err.message);
    }
  }, [conversationId]);

  // 2. Load once, then poll. Skips ticks while the tab is hidden.
  useEffect(() => {
    if (!conversationId) return undefined;
    loadMessages();
    const timer = setInterval(() => {
      if (!document.hidden) loadMessages();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [conversationId, loadMessages]);

  // 3. Keep the newest message in view, unless the user scrolled up to read.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  async function handleSend(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending || !conversationId) return;

    setSending(true);
    setSendError('');
    try {
      await apiPost(`/api/conversations/${conversationId}/messages`, { message: trimmed });
      setText('');
      stickToBottomRef.current = true;
      await loadMessages(); // refresh from the server so the list is authoritative
    } catch (err) {
      setSendError(err.message);
      loadMessages(); // e.g. the chat just closed — pick up the new state
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    // Enter sends, Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      handleSend(e);
    }
  }

  if (loadError) {
    return (
      <div className="chat-panel">
        <div className="chat-header">
          <span className="chat-header-title">Chat</span>
          {onClose && (
            <button type="button" onClick={onClose} className="btn-text">
              Close
            </button>
          )}
        </div>
        <p className="error-banner" style={{ margin: '0.75rem 1rem' }}>{loadError}</p>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="chat-panel">
        <p className="empty-state" style={{ margin: '1rem' }}>Opening conversation...</p>
      </div>
    );
  }

  const otherRole = conversation.counterpart.role;

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div>
          <div className="chat-header-title">
            Chat with {conversation.counterpart.name}{' '}
            <span className="badge badge-neutral" style={{ marginLeft: '0.35rem' }}>{otherRole}</span>
          </div>
          <div className="chat-header-sub">
            Request #{conversation.request.id} · {conversation.request.blood_group} ·{' '}
            {conversation.request.hospital_name}, {conversation.request.city}
          </div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="btn-text">
            Hide
          </button>
        )}
      </div>

      <div className="chat-messages" ref={listRef} onScroll={handleScroll} aria-live="polite">
        {messages.length === 0 ? (
          <p className="chat-empty">
            No messages yet. Say hello and coordinate the details.
          </p>
        ) : (
          messages.map((m) => {
            const mine = Number(m.sender_id) === Number(currentUserId);
            return (
              <div key={m.id} className={`chat-bubble ${mine ? 'is-mine' : 'is-theirs'}`}>
                {m.message}
                <span className="chat-time">{formatTime(m.created_at)}</span>
              </div>
            );
          })
        )}
      </div>

      {pollError && (
        <p className="chat-status-note">Couldn't refresh messages ({pollError}). Retrying...</p>
      )}

      {chatOpen ? (
        <form className="chat-composer" onSubmit={handleSend}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={MESSAGE_MAX_LENGTH}
            rows={2}
            placeholder={`Message ${conversation.counterpart.name}...`}
            aria-label="Message"
          />
          <button type="submit" className="btn btn-primary" disabled={sending || !text.trim()}>
            {sending ? 'Sending...' : 'Send'}
          </button>
        </form>
      ) : (
        <p className="chat-status-note">
          This conversation is closed. You can still read past messages, but new ones can't be sent
          because the request no longer has an accepted donor.
        </p>
      )}

      {sendError && <p className="error-banner" style={{ margin: '0 1rem 0.75rem' }}>{sendError}</p>}

      <p className="chat-footer-note">
        Chat is for coordination only — it doesn't change the request or donor status. Meet only at
        an authorized hospital or blood bank; never transport blood yourself. Avoid sharing more
        personal or medical detail than you need to.
      </p>
    </div>
  );
}
