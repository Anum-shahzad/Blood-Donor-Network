import { useEffect, useRef, useState } from 'react';
import { AlertCircleIcon } from './icons.jsx';

// In-app replacement for window.confirm / window.prompt.
//
//   import { confirmDialog, promptDialog } from '../components/ConfirmDialog.jsx';
//   if (!(await confirmDialog({ title: 'Cancel request?', message: '...', confirmLabel: 'Yes, cancel' }))) return;
//   const note = await promptDialog({ title: 'Audit note', message: '...' }); // null when dismissed
//
// <ConfirmDialogHost /> is mounted once in App.jsx and renders whatever is asked for.

let showDialog = null;

function open(options) {
  return new Promise((resolve) => {
    if (!showDialog) {
      // Host not mounted (should not happen); fail safe by declining.
      resolve(options.input ? null : false);
      return;
    }
    showDialog({ ...options, resolve });
  });
}

export function confirmDialog(options = {}) {
  return open({ ...options, input: false });
}

export function promptDialog(options = {}) {
  return open({ ...options, input: true });
}

export default function ConfirmDialogHost() {
  const [dialog, setDialog] = useState(null);
  const [value, setValue] = useState('');
  const primaryRef = useRef(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    showDialog = (d) => {
      setValue(d.defaultValue || '');
      setDialog(d);
    };
    return () => {
      showDialog = null;
    };
  }, []);

  function close(result) {
    if (!dialog) return;
    dialog.resolve(result);
    setDialog(null);
  }

  const cancel = () => close(dialog?.input ? null : false);
  const accept = () => close(dialog?.input ? value : true);

  useEffect(() => {
    if (!dialog) return undefined;
    // Safe default: focus Cancel on confirmations, the text box on prompts.
    const t = setTimeout(() => {
      if (dialog.input) primaryRef.current?.focus();
      else cancelRef.current?.focus();
    }, 0);
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        dialog.resolve(dialog.input ? null : false);
        setDialog(null);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
  }, [dialog]);

  if (!dialog) return null;

  const {
    title = 'Are you sure?',
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    input,
    inputLabel,
    placeholder,
  } = dialog;

  return (
    <div className="modal-backdrop confirm-backdrop" onClick={cancel}>
      <div
        className="modal-card confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-head">
          <span className="confirm-icon" aria-hidden="true">
            <AlertCircleIcon size={22} />
          </span>
          <h3 id="confirm-title">{title}</h3>
        </div>

        {message && <p className="confirm-message">{message}</p>}

        {input && (
          <label className="field confirm-field">
            {inputLabel && <span>{inputLabel}</span>}
            <input
              ref={primaryRef}
              type="text"
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  accept();
                }
              }}
            />
          </label>
        )}

        <div className="confirm-actions">
          <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={cancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-primary" onClick={accept}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
