import { useEffect, useId, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

export const pinIcon = L.divIcon({
  className: 'pin',
  html: '<svg viewBox="0 0 24 32" width="30" height="40"><path d="M12 0C5.4 0 0 5.3 0 11.8 0 20.6 12 32 12 32s12-11.4 12-20.2C24 5.3 18.6 0 12 0z" fill="#B3261E"/><circle cx="12" cy="12" r="4.5" fill="#fff"/></svg>',
  iconSize: [30, 40],
  iconAnchor: [15, 40],
});

const COLOMBO = [6.9271, 79.8612];
export const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
// Sri Lanka bounding box for suggestions: minLon, minLat, maxLon, maxLat
const SL_BBOX = '79.4,5.7,82.1,10.0';

// Pull coordinates out of pasted text: "6.8712, 79.8601" or a full Google Maps link.
export function parseLocation(text) {
  const t = decodeURIComponent(String(text || '')).trim();
  if (!t) return null;
  const ok = (a, b) => {
    const lat = Number(a), lng = Number(b);
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
  };
  let m = t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/); // exact place pin in Google links
  if (m) return ok(m[1], m[2]);
  m = t.match(/[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (m) return ok(m[1], m[2]);
  m = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return ok(m[1], m[2]);
  m = t.match(/^(-?\d{1,2}\.\d{3,})\s*[, ]\s*(-?\d{1,3}\.\d{3,})$/);
  if (m) return ok(m[1], m[2]);
  return null;
}

const isShortLink = (t) => /(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(t);

function describe(p) {
  const main = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city || 'Unnamed place';
  const rest = [p.name && p.street ? [p.housenumber, p.street].filter(Boolean).join(' ') : null,
    p.district || p.locality, p.city, p.county || p.state]
    .filter((v, i, a) => v && v !== main && a.indexOf(v) === i);
  return { main, sub: rest.join(', ') };
}

function ClickToPin({ onPick }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => { if (target) map.flyTo(target, 17, { duration: 0.6 }); }, [target, map]);
  return null;
}

export default function MapPicker({ lat, lng, onChange }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [flyTarget, setFlyTarget] = useState(null);
  const listId = useId();
  const reqId = useRef(0);
  const has = lat != null && lng != null;

  // Suggestions as you type (debounced). Pasted coordinates/links are handled instantly.
  useEffect(() => {
    const q = query.trim();
    setMsg('');
    if (!q) { setItems([]); return; }
    const coords = parseLocation(q);
    if (coords) {
      setItems([{ key: 'coords', main: `Drop the pin at ${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`, sub: 'From the pasted location', pos: coords }]);
      setOpen(true); setHi(0);
      return;
    }
    if (isShortLink(q)) {
      setItems([]);
      setMsg('Short Google links can\'t be read. In Google Maps, press and hold the exact spot, copy the numbers shown (like 6.8712, 79.8601) and paste them here.');
      return;
    }
    if (q.length < 3) { setItems([]); return; }
    const id = ++reqId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=7&lang=en&bbox=${SL_BBOX}&lat=${COLOMBO[0]}&lon=${COLOMBO[1]}`;
        const res = await fetch(url);
        const data = await res.json();
        if (id !== reqId.current) return;
        const list = (data.features ?? []).map((f, i) => ({
          key: `${f.properties.osm_type}${f.properties.osm_id}-${i}`,
          ...describe(f.properties),
          pos: [f.geometry.coordinates[1], f.geometry.coordinates[0]],
        }));
        setItems(list); setOpen(true); setHi(0);
        if (!list.length) setMsg('No matches. Try a road or town nearby, or paste the location from Google Maps.');
      } catch {
        if (id === reqId.current) setMsg('Suggestions are unavailable right now. Tap the map, or paste the location from Google Maps.');
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  function choose(item) {
    if (!item) return;
    onChange(item.pos[0], item.pos[1]);
    setFlyTarget(item.pos);
    setQuery(''); setItems([]); setOpen(false); setMsg('');
  }

  function useMine() {
    if (!navigator.geolocation) { setMsg('This device cannot share its location.'); return; }
    setMsg('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => { const p = [pos.coords.latitude, pos.coords.longitude]; onChange(p[0], p[1]); setFlyTarget(p); setMsg(''); },
      () => setMsg('Location permission was refused. Tap the map instead.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  return (
    <div className="mappicker">
      <div className="map-tools">
        <div className="combo map-search">
          <input
            role="combobox" aria-expanded={open && items.length > 0} aria-controls={listId} aria-autocomplete="list"
            value={query} placeholder="Search a place, or paste a Google Maps location"
            aria-label="Search the map"
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, items.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); choose(items[hi]); }
              else if (e.key === 'Escape') setOpen(false);
            }}
          />
          {loading && <span className="combo-spin" aria-hidden="true" />}
          {open && items.length > 0 && (
            <ul className="combo-list" role="listbox" id={listId}>
              {items.map((it, i) => (
                <li key={it.key} role="option" aria-selected={i === hi} className={`place${i === hi ? ' hi' : ''}`}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => choose(it)} onMouseEnter={() => setHi(i)}>
                  <span>{it.main}</span>
                  {it.sub && <span className="muted small">{it.sub}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" className="btn" onClick={useMine}>Use my location</button>
        {has && <button type="button" className="btn ghost" onClick={() => onChange(null, null)}>Remove pin</button>}
      </div>
      {msg && <p className="hint">{msg}</p>}
      <div className="map">
        <MapContainer center={has ? [lat, lng] : COLOMBO} zoom={has ? 16 : 11} scrollWheelZoom>
          <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
          <ClickToPin onPick={onChange} />
          <FlyTo target={flyTarget} />
          {has && (
            <Marker position={[lat, lng]} icon={pinIcon} draggable
              eventHandlers={{ dragend: (e) => { const p = e.target.getLatLng(); onChange(p.lat, p.lng); } }} />
          )}
        </MapContainer>
      </div>
      <p className="hint">
        {has ? 'Drag the pin to fine-tune it.' : 'Pick a suggestion, paste a location, or tap the map where the driver should go.'}
      </p>
    </div>
  );
}
