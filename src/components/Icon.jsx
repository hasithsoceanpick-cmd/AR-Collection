// Line icons for the menu and top bar (decorative: the text next to them says what they are).
const PATHS = {
  today: <path d="M4 12h4l3-7 3 14 3-7h3" />,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  bank: <><path d="M3 10 12 4l9 6" /><path d="M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18" /></>,
  bc: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></>,
  people: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .7 3 2.8 3 6" /></>,
  chart: <path d="M5 20V10M12 20V4M19 20v-7" />,
  gear: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>,
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  upload: <><path d="M12 16V4" /><path d="m6 10 6-6 6 6" /><path d="M4 20h16" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  swap: <path d="M4 9h14l-3-3M20 15H6l3 3" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
};

export default function Icon({ name, size = 20, className = '' }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[name] ?? null}</svg>
  );
}
