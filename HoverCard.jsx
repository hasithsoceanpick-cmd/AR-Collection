import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// A button that shows a card while the mouse is over it or it has focus (a tap on a phone).
// The card is drawn over the page, so tables that scroll sideways don't clip it.
export default function HoverCard({ children, card, className = '', label }) {
  const id = useId();
  const btn = useRef(null);
  const box = useRef(null);
  const timer = useRef(0);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);

  const show = () => { clearTimeout(timer.current); setOpen(true); };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 150); };
  useEffect(() => () => clearTimeout(timer.current), []);

  // place the card under the button (or above it when there is no room below), inside the screen
  const place = () => {
    if (!btn.current || !box.current) return false;
    const a = btn.current.getBoundingClientRect();
    const c = box.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    if (a.bottom < 0 || a.top > vh) return false;   // the button has scrolled out of sight
    const left = Math.max(8, Math.min(a.left, vw - c.width - 8));
    let top = a.bottom + 6;
    if (top + c.height > vh - 8 && a.top - c.height - 6 > 8) top = a.top - c.height - 6;
    setPos({ left, top });
    return true;
  };
  useLayoutEffect(() => { if (open) place(); else setPos(null); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const follow = (e) => { if (!box.current?.contains(e.target) && !place()) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    document.addEventListener('keydown', key);
    return () => { window.removeEventListener('scroll', follow, true); window.removeEventListener('resize', follow); document.removeEventListener('keydown', key); };
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <button type="button" ref={btn} className={`hovercard-trigger ${className}`} aria-describedby={open ? id : undefined} aria-label={label}
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={(e) => { if (!box.current?.contains(e.relatedTarget)) hide(); }}
        onClick={(e) => { e.stopPropagation(); show(); }}>
        {children}
      </button>
      {open && createPortal(
        <div id={id} role="tooltip" ref={box} className="hovercard" onMouseEnter={show} onMouseLeave={hide} onFocus={show}
          onBlur={(e) => { if (!box.current?.contains(e.relatedTarget) && e.relatedTarget !== btn.current) hide(); }}
          style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}>
          {card}
        </div>, document.body)}
    </>
  );
}
