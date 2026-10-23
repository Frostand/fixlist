import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeoPoint } from '../../community/types';
import { useLanguage, useT } from '../../i18n';
export interface MapPin { id: string; point: GeoPoint; score: number; title: string }
export default function NearbyMap({ pins, center, onOpen, mini = false }: {
    pins: readonly MapPin[];
    center: GeoPoint;
    onOpen?(id: string): void;
    mini?: boolean;
}) {
    const t = useT(), language = useLanguage(), container = useRef<HTMLDivElement>(null), [failed, setFailed] = useState(false);
    const open = useRef(onOpen);
    open.current = onOpen;
    useEffect(() => {
        if (!container.current) return;
        setFailed(false);
        const map = L.map(container.current, {
            scrollWheelZoom: false, zoomControl: false, dragging: !mini, touchZoom: !mini,
            doubleClickZoom: !mini, boxZoom: !mini, keyboard: !mini,
        }).setView([center.lat, center.lng], mini ? 13 : 11);
        if (!mini) {
            // Leaflet applies the translated titles to both title and aria-label.
            L.control.zoom({ zoomInTitle: t('c.map.zoomIn'), zoomOutTitle: t('c.map.zoomOut'), zoomInText: '+', zoomOutText: '−' }).addTo(map);
            const label = document.createElement('span');
            label.textContent = t('c.map.you');
            L.circleMarker([center.lat, center.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#2F6FA3', fillOpacity: 1, interactive: false })
                .addTo(map).bindTooltip(label, { permanent: true, direction: 'bottom', offset: [0, 9], className: 'c-you-label' });
        }
        map.attributionControl.setPrefix(false);
        const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: `<a href="https://www.openstreetmap.org/copyright">${t('c.map.credit')}</a>` }).addTo(map);
        let failures = 0;
        tiles.on('tileerror', () => { if (++failures >= 3) setFailed(true); });
        for (const pin of pins) {
            // Small dots leave the street/city labels readable; full scores stay in the list.
            const icon = L.divIcon({ className: `c-map-pin ${mini ? 'c-pin-destination' : pin.score >= 75 ? 'c-pin-high' : pin.score >= 50 ? 'c-pin-mid' : 'c-pin-low'}`, html: '<span aria-hidden="true"></span>', iconSize: [48, 48], iconAnchor: [24, 24] });
            const label = mini ? pin.title : `${pin.title} · ${t('c.nearby.match', { score: pin.score })}`;
            const marker = L.marker([pin.point.lat, pin.point.lng], { icon, title: label, alt: label, interactive: !mini, keyboard: !mini }).addTo(map);
            if (!mini) marker.on('click', () => open.current?.(pin.id));
        }
        const points: L.LatLngTuple[] = [[center.lat, center.lng], ...pins.map(p => [p.point.lat, p.point.lng] as L.LatLngTuple)];
        const fit = () => map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: mini ? 13 : 12 });
        fit();
        const timer = window.setTimeout(() => { map.invalidateSize(); fit(); }, 150);
        return () => { window.clearTimeout(timer); map.remove(); };
    }, [pins, center.lat, center.lng, mini, language]);
    return <section className={`c-map-wrap ${mini ? 'c-mini-map' : ''}`} aria-label={t(mini ? 'c.map.destination' : 'c.nearby.map')}><div ref={container} className="c-map"/>{failed ? <p role="status" className="c-map-failure">{t('c.nearby.mapUnavailable')}</p> : null}<p className="c-map-note">{t('c.nearby.approximate')} <a href="https://www.openstreetmap.org/copyright">{t('c.map.credit')}</a></p></section>;
}
