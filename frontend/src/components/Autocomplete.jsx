import { useId, useState } from 'react';

// Accessible text input with a suggestion list (ARIA combobox pattern).
// - Free text is always allowed: suggestions never replace what is typed.
// - Enter only selects when a suggestion is highlighted; otherwise it behaves
//   like a normal input, so the form still submits as before.
// - Extra props (placeholder, required, ...) go straight to the <input>.
export default function Autocomplete({ value, onChange, items, emptyMessage, ariaLabel, ...inputProps }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const showList = open && (items.length > 0 || Boolean(emptyMessage));
  const optionId = (i) => `${listId}-opt-${i}`;

  function choose(item) {
    onChange(item);
    setOpen(false);
    setActive(-1);
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (items.length === 0) return;
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(e.key === 'ArrowDown' ? 0 : items.length - 1);
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + step + items.length) % items.length);
    } else if (e.key === 'Enter') {
      if (showList && active >= 0 && items[active]) {
        e.preventDefault(); // pick the suggestion instead of submitting the form
        choose(items[active]);
      }
    } else if (e.key === 'Escape') {
      if (showList) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      }
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div className="autocomplete">
      <input
        {...inputProps}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        onKeyDown={handleKeyDown}
      />
      {showList && (
        <ul className="autocomplete-list" id={listId} role="listbox">
          {items.map((item, i) => (
            <li
              key={item}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={`autocomplete-option${i === active ? ' is-active' : ''}`}
              // mousedown (not click) so the input keeps focus and blur doesn't
              // close the list before the choice registers; works for touch too.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item);
              }}
            >
              {item}
            </li>
          ))}
          {items.length === 0 && emptyMessage && (
            <li className="autocomplete-empty" role="presentation">{emptyMessage}</li>
          )}
        </ul>
      )}
    </div>
  );
}
