import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NearbyMap from './NearbyMap';
const mocks = vi.hoisted(() => ({ effects: [] as Array<() => (() => void) | void>, container: {}, map: vi.fn(), zoom: vi.fn(), tileLayer: vi.fn(), marker: vi.fn(), circleMarker: vi.fn(), divIcon: vi.fn(), latLngBounds: vi.fn(), fitBounds: vi.fn(), remove: vi.fn(), invalidate: vi.fn(), bindTooltip: vi.fn(), markerClick: vi.fn() }));
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(), useEffect: (effect: () => (() => void) | void) => { mocks.effects.push(effect); }, useRef: (initial: unknown) => ({ current: initial === null ? mocks.container : initial }) }));
vi.mock('leaflet', () => ({ map: mocks.map, control: { zoom: mocks.zoom }, tileLayer: mocks.tileLayer, marker: mocks.marker, circleMarker: mocks.circleMarker, divIcon: mocks.divIcon, latLngBounds: mocks.latLngBounds }));
const center = { lat: 34.128, lng: -84.110 }, destination = { lat: 34.0515, lng: -84.0713 };
function mount(mini = false) {
    mocks.map.mockReturnValue({ setView: () => ({ attributionControl: { setPrefix() {} }, fitBounds: mocks.fitBounds, invalidateSize: mocks.invalidate, remove: mocks.remove }) });
    mocks.zoom.mockReturnValue({ addTo() {} });
    mocks.tileLayer.mockReturnValue({ addTo: () => ({ on() {} }) });
    mocks.circleMarker.mockReturnValue({ addTo: () => ({ bindTooltip: mocks.bindTooltip }) });
    mocks.marker.mockReturnValue({ addTo: () => ({ on: mocks.markerClick }) });
    mocks.divIcon.mockImplementation(options => options); mocks.latLngBounds.mockImplementation(points => points);
    vi.stubGlobal('window', { setTimeout: () => 123, clearTimeout: vi.fn() });
    vi.stubGlobal('document', { createElement: () => ({ textContent: '' }) });
    const open = vi.fn();
    renderToStaticMarkup(<NearbyMap pins={[{ id: 'job', point: destination, title: 'Fictional request', score: 98 }]} center={center} onOpen={open} mini={mini}/>);
    const cleanup = mocks.effects.pop()!(); return { open, cleanup };
}
afterEach(() => { mocks.effects.length = 0; vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('community Leaflet maps', () => {
    it('uses +/- glyphs with translated title labels and fits the visible pin plus You with padding', () => {
        const { open, cleanup } = mount();
        expect(mocks.zoom).toHaveBeenCalledWith({ zoomInTitle: 'Zoom in', zoomOutTitle: 'Zoom out', zoomInText: '+', zoomOutText: '−' });
        expect(mocks.circleMarker).toHaveBeenCalledWith([center.lat, center.lng], expect.objectContaining({ interactive: false, fillColor: '#2F6FA3' }));
        expect(mocks.bindTooltip).toHaveBeenCalledWith({ textContent: 'You' }, expect.objectContaining({ permanent: true }));
        expect(mocks.fitBounds).toHaveBeenCalledWith([[center.lat, center.lng], [destination.lat, destination.lng]], { padding: [40, 40], maxZoom: 12 });
        const click = mocks.markerClick.mock.calls[0]![1] as () => void; click(); expect(open).toHaveBeenCalledWith('job');
        cleanup?.(); expect(mocks.remove).toHaveBeenCalledOnce();
    });
    it('keeps the reused destination mini-map non-interactive with no You or zoom controls', () => {
        const { cleanup } = mount(true);
        expect(mocks.map).toHaveBeenCalledWith(mocks.container, expect.objectContaining({ dragging: false, touchZoom: false, keyboard: false, doubleClickZoom: false, scrollWheelZoom: false }));
        expect(mocks.marker).toHaveBeenCalledWith([destination.lat, destination.lng], expect.objectContaining({ interactive: false, keyboard: false }));
        expect(mocks.zoom).not.toHaveBeenCalled(); expect(mocks.circleMarker).not.toHaveBeenCalled(); expect(mocks.markerClick).not.toHaveBeenCalled();
        cleanup?.();
    });
});
