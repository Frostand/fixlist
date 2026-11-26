/** Browser-only synthetic QA harness, excluded from app entry points. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../i18n';
import { RoomCapture } from '../app/community/RoomCapture';
import { VolunteerJob } from '../app/community/Volunteer';
import { RoomTour, hazardEvidence } from '../app/community/RoomTour';
import { tourHazards } from '../lib/room-tour-geometry';
import { createSeedState } from '../community';
import { getCommunityCaptureStore, type StoredCapture } from '../lib/capture-storage';
import { sha256Blob } from '../lib/capture-model';
import '../styles/base.css';
import '../styles/community.css';

const canvas = document.createElement('canvas'); canvas.width = 4096; canvas.height = 2048;
const ctx = canvas.getContext('2d')!;
ctx.fillStyle = '#dbe8e4'; ctx.fillRect(0, 0, 4096, 1024); ctx.fillStyle = '#bb9c76'; ctx.fillRect(0, 1024, 4096, 1024);
for (let x = 0; x <= 4096; x += 256) { ctx.strokeStyle = '#758e85'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 2048); ctx.stroke(); }
for (let y = 0; y <= 2048; y += 256) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(4096, y); ctx.stroke(); }
ctx.textAlign = 'center'; ctx.font = 'bold 110px sans-serif';
for (const [x, label, color] of [[0, 'S · +Z', '#8e4938'], [1024, 'W · −X', '#5c618c'], [2048, 'N · −Z', '#245f4b'], [3072, 'E · +X', '#2b667f'], [4096, 'S · +Z', '#8e4938']] as const) {
  ctx.fillStyle = color; ctx.fillRect(x - 340, 630, 680, 290); ctx.fillStyle = 'white'; ctx.fillText(label, x, 810);
}
ctx.fillStyle = '#304d42'; ctx.fillRect(2260, 1080, 180, 330); ctx.fillStyle = '#fcf0d7'; ctx.fillRect(2275, 1100, 150, 150);
ctx.strokeStyle = '#aa3d29'; ctx.lineWidth = 18; ctx.beginPath(); ctx.moveTo(1700, 1310); ctx.bezierCurveTo(1900, 1180, 2100, 1450, 2440, 1300); ctx.stroke();
const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/jpeg', 0.9));
const hash = await sha256Blob(blob);
const record: StoredCapture = { manifest: { format: 'fixlist-room-capture', version: 1, captureId: 'cap-synthetic-360-qa', roomId: 'living-room', createdAt: '2026-10-25T20:00:00Z', mode: 'arkit', floorY: 0, outline: { closed: true, points: [[-2, -4], [3, -4], [3, 2], [-2, 2]] }, doors: [], photos: [], tour: { format: 'fixlist-room-tour', version: 1, stops: [
 { stopId: 's1', position: [0, 1.5, 0], panorama: { fileId: 'pano-s1', width: 4096, height: 2048, sha256: hash, coverage: 1 }, capturedAt: '2026-10-25T20:00:00Z' },
 { stopId: 's2', position: [1, 1.5, -2], panorama: { fileId: 'pano-s2', width: 4096, height: 2048, sha256: hash, coverage: 1 }, capturedAt: '2026-10-25T20:00:00Z' },
] } }, photos: new Map(), flags: null };
record.manifest = { ...record.manifest, captureId: 'cap-synthetic-360-qa', tour: { ...record.manifest.tour!, stops: record.manifest.tour!.stops.map(s => ({ ...s, panorama: { ...s.panorama, sha256: hash, coverage: 1 } })) } };
record.panoramaBlobs = new Map([['pano-s1', blob], ['pano-s2', blob]]);
const thumbnail = document.createElement('canvas'); thumbnail.width = 240; thumbnail.height = 150;
thumbnail.getContext('2d')!.drawImage(canvas, 1650, 1050, 900, 600, 0, 0, 240, 150);
const thumb = thumbnail.toDataURL('image/jpeg', 0.7);
record.aiReview = { format: 'fixlist-ai-review', version: 1, captureId: record.manifest.captureId, roomId: record.manifest.roomId, createdAt: record.manifest.createdAt,
 sources: record.manifest.tour!.stops.map(s => ({ kind: 'panorama', id: s.stopId, sha256: hash, model: 'synthetic-vision', hazards: [{ label: 'Cord across the walking path', detail: 'A visible cord crosses the route beside the chair.', tip: 'Ask someone to route the cord along the wall.', category: 'trip', severity: 'high', box: null, direction: [0, -0.3, -Math.sqrt(.91)], thumbnail: null }] })) }; record.aiReview = { ...record.aiReview, sources: record.aiReview.sources.map(s => ({ ...s, hazards: s.hazards.map(h => ({ ...h, thumbnail: thumb })) })) };
const seed = createSeedState('2026-10-25T20:00:00Z'), base = seed.jobs[0]!, elder = seed.accounts.find(a => a.id === base.elderId)!;
const store = getCommunityCaptureStore(elder.id, 'synthetic-360-qa');
await store.writeCapture(record.manifest, record.photos, true, undefined, undefined, { videos: null, videoBlobs: new Map(), panoramaBlobs: record.panoramaBlobs });
if (!new URLSearchParams(location.search).has('download')) await store.writeAIReview!(record.manifest.roomId, record.aiReview);
const hazard = tourHazards(record.manifest, record.aiReview, [], record.manifest.tour!.stops[0]!)[0]!;
const evidence = hazardEvidence(record, hazard), job = { ...base, evidence: [evidence] };
function Fixture() {
  const [role, setRole] = useState('resident'), [drafted, setDrafted] = useState(false);
  return <I18nProvider language="en"><main className={`community ${role === 'volunteer' ? 'c-volunteer' : ''}`} style={{ padding: 14, maxWidth: 600, margin: 'auto' }}>
    <p style={{ fontSize: 13 }}>Synthetic fixture · no real home or model inference</p>
    <nav style={{ display: 'flex', gap: 5, marginBottom: 12 }}><button onClick={() => setRole('resident')}>Resident</button><button onClick={() => setRole('volunteer')}>Volunteer job</button><button onClick={() => setRole('tour')}>Tour only</button></nav>
    {drafted ? <p role="status">Help draft ready for resident review</p> : null}
    {role === 'resident' ? <RoomCapture ownerId={elder.id} resetEpoch="synthetic-360-qa" onDraft={() => setDrafted(true)} onType={() => {}}/> : role === 'volunteer' ? <VolunteerJob job={job} elder={elder} address={null} profile={seed.volunteers[0]!} match={null} onAccept={() => false} onStep={() => false} onMessages={() => {}} captureScope={{ ownerId: elder.id, resetEpoch: 'synthetic-360-qa', isCurrent: () => true }}/> : <RoomTour record={record} onDraft={() => setDrafted(true)}/>}
  </main></I18nProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
