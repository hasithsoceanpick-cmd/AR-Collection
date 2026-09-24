import { useEffect, useState } from 'react';
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

function ClickToPin({ onPick }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => { if (target) map.flyTo(target, 16, { duration: 0.6 }); }, [target, map]);
  return null;
}

export default function MapPicker({ lat, lng, onChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [flyTarget, setFlyTarget] = useState(null);
  const has = lat != null && lng != null;

  async function search(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true); setMsg('');
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=lk&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();
      setResults(data);
      if (!data.length) setMsg('No places found. Try a nearby town or road, then tap the exact spot.');
    } catch {
      setMsg('Search is unavailable right now. Tap the map to drop the pin.');
    } finally { setBusy(false); }
  }

  function choose(r) {
    const p = [Number(r.lat), Number(r.lon)];
    onChange(p[0], p[1]); setFlyTarget(p); setResults([]);
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
        <form onSubmit={search} className="map-search">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a place or road" aria-label="Search the map" />
          <button className="btn" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
        </form>
        <button type="button" className="btn" onClick={useMine}>Use my location</button>
        {has && <button type="button" className="btn ghost" onClick={() => onChange(null, null)}>Remove pin</button>}
      </div>
      {results.length > 0 && (
        <ul className="map-results">
          {results.map((r) => (
            <li key={r.place_id}><button type="button" onClick={() => choose(r)}>{r.display_name}</button></li>
          ))}
        </ul>
      )}
      {msg && <p className="hint">{msg}</p>}
      <div className="map">
        <MapContainer center={has ? [lat, lng] : COLOMBO} zoom={has ? 15 : 11} scrollWheelZoom>
          <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
          <ClickToPin onPick={onChange} />
          <FlyTo target={flyTarget} />
          {has && (
            <Marker position={[lat, lng]} icon={pinIcon} draggable
              eventHandlers={{ dragend: (e) => { const p = e.target.getLatLng(); onChange(p.lat, p.lng); } }} />
          )}
        </MapContainer>
      </div>
      <p className="hint">{has ? 'Drag the pin to adjust it.' : 'Tap the map where the driver should go.'}</p>
    </div>
  );
}
