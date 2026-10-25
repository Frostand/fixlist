export function decodeWav(data) {
  if (data.length < 44 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE' || data.readUInt32LE(4) + 8 !== data.length) throw new Error('Invalid/truncated WAV');
  let format, pcm;
  for (let offset = 12; offset + 8 <= data.length;) {
    const id = data.toString('ascii', offset, offset + 4), size = data.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > data.length) throw new Error('Truncated WAV chunk');
    if (id === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV format chunk');
      format = { encoding: data.readUInt16LE(start), channels: data.readUInt16LE(start + 2), sampleRate: data.readUInt32LE(start + 4), byteRate: data.readUInt32LE(start + 8), blockAlign: data.readUInt16LE(start + 12), bitsPerSample: data.readUInt16LE(start + 14) };
    }
    if (id === 'data') { if (pcm) throw new Error('Duplicate WAV data'); pcm = data.subarray(start, start + size); }
    offset = start + size + (size % 2);
  }
  if (!format || !pcm || format.encoding !== 1 || format.channels !== 1 || format.sampleRate !== 24000 || format.bitsPerSample !== 16 || format.byteRate !== 48000 || format.blockAlign !== 2 || !pcm.length || pcm.length % 2) throw new Error('Expected nonempty mono PCM16 24kHz WAV');
  const samples = Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2));
  return { format, samples, durationSeconds: samples.length / format.sampleRate };
}
export function pcmMetrics(samples, sampleRate = 24000) {
  let max = 0, squares = 0, fullScaleSamples = 0;
  for (const value of samples) { max = Math.max(max, Math.abs(value)); squares += value * value; if (Math.abs(value) >= 32767) fullScaleSamples++; }
  const threshold = Math.pow(10, -45 / 20) * 32768;
  const first = samples.findIndex(value => Math.abs(value) > threshold);
  let last = samples.length - 1; while (last >= 0 && Math.abs(samples[last]) <= threshold) last--;
  const peak = window => window.reduce((m, value) => Math.max(m, Math.abs(value)), 0) / 32768;
  return { peak: max / 32768, rms: Math.sqrt(squares / samples.length) / 32768, fullScaleSamples, silenceThresholdDBFS: -45,
    leadingSilenceMs: (first < 0 ? samples.length : first) / sampleRate * 1000, trailingSilenceMs: (samples.length - last - 1) / sampleRate * 1000,
    first20msPeak: peak(samples.slice(0, 480)), last20msPeak: peak(samples.slice(-480)) };
}
export function encodeWav(samples) {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(24000, 24); data.writeUInt32LE(48000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, i) => data.writeInt16LE(value, 44 + i * 2)); return data;
}
