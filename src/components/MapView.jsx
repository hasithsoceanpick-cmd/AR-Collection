import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import { pinIcon, TILE_URL, TILE_ATTR } from './MapPicker';

export default function MapView({ lat, lng }) {
  return (
    <div className="map map-small">
      <MapContainer center={[lat, lng]} zoom={15} scrollWheelZoom={false}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
        <Marker position={[lat, lng]} icon={pinIcon} />
      </MapContainer>
    </div>
  );
}

export const directionsUrl = (lat, lng) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
