import { useId, useMemo, useState } from 'react';

// Searchable customer dropdown. `selected` is { customer_no, name } or null.
export default function CustomerPicker({ customers, selected, onSelect }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const listId = useId();

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t
      ? customers.filter((c) => c.name.toLowerCase().includes(t) || c.customer_no.toLowerCase().includes(t))
      : customers;
    return list.slice(0, 50);
  }, [q, customers]);

  const options = [...matches.map((c) => ({ c })), ...(q.trim() ? [{ manual: q.trim() }] : [])];

  function choose(o) {
    if (!o) return;
    onSelect(o.manual ? { customer_no: null, name: o.manual } : o.c);
    setQ(''); setOpen(false); setHi(0);
  }

  if (selected) {
    return (
      <div className="picked">
        <div>
          <strong>{selected.name}</strong>
          <span className="muted">{selected.customer_no ?? 'Not in the customer list'}</span>
        </div>
        <button type="button" className="btn ghost" onClick={() => onSelect(null)}>Change</button>
      </div>
    );
  }

  return (
    <div className="combo">
      <input
        role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        placeholder={customers.length ? 'Type a customer name or code' : 'Type the customer name'}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, options.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); choose(options[hi]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && options.length > 0 && (
        <ul className="combo-list" role="listbox" id={listId}>
          {options.map((o, i) => (
            <li key={o.manual ? '__manual' : o.c.customer_no} role="option" aria-selected={i === hi}
              className={i === hi ? 'hi' : ''}
              onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)} onMouseEnter={() => setHi(i)}>
              {o.manual
                ? <span>Use “{o.manual}” (not in the customer list)</span>
                : <><span>{o.c.name}</span><span className="muted">{o.c.customer_no}</span></>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
