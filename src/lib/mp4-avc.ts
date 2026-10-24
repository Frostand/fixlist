/** Bounded AVCDecoderConfigurationRecord/SPS parsing; no browser decoder or codec-label trust. */
export function avcConfiguration(bytes: Uint8Array): { width: number; height: number; nalLength: number } {
  const bad = (): never => { throw new Error('Invalid H.264 configuration.'); };
  if (bytes.length < 7 || bytes.length > 65536 || bytes[0] !== 1) bad();
  const nalLength = (bytes[4]! & 3) + 1;
  if (nalLength === 3 || (bytes[4]! & 0xfc) !== 0xfc || (bytes[5]! & 0xe0) !== 0xe0) bad();
  let at = 6;
  const readNal = () => {
    if (at + 2 > bytes.length) return bad();
    const length = bytes[at]! * 256 + bytes[at + 1]!; at += 2;
    if (!length || at + length > bytes.length) return bad();
    const nal = bytes.subarray(at, at + length); at += length; return nal;
  };
  const count = bytes[5]! & 31;
  if (!count || count > 16) bad();
  let dimensions: { width: number; height: number } | undefined;
  for (let i = 0; i < count; i++) {
    const nal = readNal(); if ((nal[0]! & 31) !== 7) bad();
    const next = spsDimensions(nal);
    if (dimensions && (next.width !== dimensions.width || next.height !== dimensions.height)) bad();
    dimensions = next;
  }
  if (at >= bytes.length) bad();
  const ppsCount = bytes[at++]!; if (!ppsCount || ppsCount > 16) bad();
  for (let i = 0; i < ppsCount; i++) if ((readNal()[0]! & 31) !== 8) bad();
  // High-profile records can append chroma/bit-depth fields and SPS extensions.
  if (at < bytes.length) {
    if (![100, 110, 122, 144].includes(bytes[1]!) || at + 4 > bytes.length) bad();
    if ((bytes[at]! & 0xfc) !== 0xfc || (bytes[at + 1]! & 0xf8) !== 0xf8 || (bytes[at + 2]! & 0xf8) !== 0xf8) bad();
    at += 3; const extensions = bytes[at++]!; if (extensions > 16) bad();
    for (let i = 0; i < extensions; i++) if ((readNal()[0]! & 31) !== 13) bad();
  }
  if (at !== bytes.length || !dimensions) return bad();
  return { ...dimensions, nalLength };
}

function spsDimensions(nal: Uint8Array): { width: number; height: number } {
  const rbsp: number[] = [];
  for (let i = 1; i < nal.length; i++) {
    if (i >= 3 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue;
    rbsp.push(nal[i]!);
  }
  let position = 0;
  function bits(n: number): number {
    if (position + n > rbsp.length * 8 || n > 32) throw new Error('Truncated H.264 SPS.');
    let value = 0; while (n--) { value = value * 2 + ((rbsp[position >> 3]! >> (7 - (position & 7))) & 1); position++; } return value;
  }
  function ue(): number { let zeros = 0; while (!bits(1)) if (++zeros > 24) throw new Error('Oversized H.264 SPS value.'); return 2 ** zeros - 1 + bits(zeros); }
  const se = () => { const value = ue(); return value & 1 ? (value + 1) / 2 : -value / 2; };
  const profile = bits(8); bits(16); ue();
  let chroma = 1, separate = 0;
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
    chroma = ue(); if (chroma > 3) throw new Error('Invalid H.264 chroma format.');
    if (chroma === 3) separate = bits(1);
    ue(); ue(); bits(1);
    if (bits(1)) for (let i = 0; i < (chroma !== 3 ? 8 : 12); i++) if (bits(1)) {
      let last = 8, next = 8;
      for (let j = 0; j < (i < 6 ? 16 : 64); j++) { if (next) next = (last + se() + 256) % 256; last = next || last; }
    }
  }
  ue(); const order = ue();
  if (order === 0) ue();
  else if (order === 1) { bits(1); se(); se(); const cycle = ue(); if (cycle > 256) throw new Error('Invalid H.264 cycle.'); for (let i = 0; i < cycle; i++) se(); }
  else if (order !== 2) throw new Error('Invalid H.264 picture order.');
  ue(); bits(1); const columns = ue() + 1, rows = ue() + 1, frame = bits(1);
  if (!frame) bits(1); bits(1);
  let left = 0, right = 0, top = 0, bottom = 0;
  if (bits(1)) { left = ue(); right = ue(); top = ue(); bottom = ue(); }
  const arrayType = separate ? 0 : chroma, cropX = arrayType === 0 || arrayType === 3 ? 1 : 2, cropY = (arrayType === 1 ? 2 : 1) * (2 - frame);
  return { width: columns * 16 - (left + right) * cropX, height: rows * 16 * (2 - frame) - (top + bottom) * cropY };
}
