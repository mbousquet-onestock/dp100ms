import 'leaflet/dist/leaflet.css';
import { useEffect, type ReactNode } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';

const FRANCE: LatLngBoundsExpression = [
  [41.3, -5.2],
  [51.2, 9.7],
];

export function FranceMap({ children, height = 420, bounds, className }: { children?: ReactNode; height?: number | string; bounds?: LatLngBoundsExpression | null; className?: string }) {
  return (
    <div className={className} style={{ height }}>
      <MapContainer bounds={FRANCE} style={{ height: '100%', width: '100%', borderRadius: 5 }} scrollWheelZoom preferCanvas>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={18}
        />
        <FitBounds bounds={bounds} />
        <InvalidateOnResize />
        {children}
      </MapContainer>
    </div>
  );
}

function FitBounds({ bounds }: { bounds?: LatLngBoundsExpression | null }) {
  const map = useMap();
  const key = bounds ? JSON.stringify(bounds) : '';
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 9 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}
