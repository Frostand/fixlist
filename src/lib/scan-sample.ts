import type { Point3, ScanAsset } from './scan-model';

export interface SampleSplat { position: Point3; scale: Point3; rgba: [number, number, number, number]; rotation: [number, number, number, number] }
/** antimatter15 .splat: XYZ f32 LE, linear scales f32 LE, RGBA u8, quaternion u8 WXYZ. */
export function encodeSampleSplats(splats: readonly SampleSplat[]): ArrayBuffer {
  const buffer = new ArrayBuffer(splats.length * 32), view = new DataView(buffer);
  splats.forEach((splat, index) => {
    const offset = index * 32;
    splat.position.forEach((value, axis) => view.setFloat32(offset + axis * 4, value, true));
    splat.scale.forEach((value, axis) => view.setFloat32(offset + 12 + axis * 4, value, true));
    splat.rgba.forEach((value, axis) => view.setUint8(offset + 24 + axis, value));
    splat.rotation.forEach((value, axis) => view.setUint8(offset + 28 + axis, Math.min(255, Math.max(0, Math.round((value + 1) * 127.5)))));
  });
  return buffer;
}
export function generateSampleRoom(): ScanAsset {
  const splats: SampleSplat[] = [];
  function surface(origin: Point3, u: Point3, v: Point3, color: [number, number, number]) {
    const uSteps = Math.ceil(Math.hypot(...u) / 0.04), vSteps = Math.ceil(Math.hypot(...v) / 0.04);
    for (let i = 0; i <= uSteps; i++) for (let j = 0; j <= vSteps; j++) {
      const shade = ((i * 7 + j * 13) % 9) - 4;
      splats.push({
        position: [origin[0] + u[0] * i / uSteps + v[0] * j / vSteps, origin[1] + u[1] * i / uSteps + v[1] * j / vSteps, origin[2] + u[2] * i / uSteps + v[2] * j / vSteps],
        scale: [0.027, 0.027, 0.027], rgba: [color[0] + shade, color[1] + shade, color[2] + shade, 245], rotation: [1, 0, 0, 0],
      });
    }
  }
  function box(min: Point3, size: Point3, color: [number, number, number]) {
    const [x, y, z] = min, [w, h, d] = size;
    surface([x, y, z], [w, 0, 0], [0, h, 0], color);
    surface([x, y, z + d], [w, 0, 0], [0, h, 0], color);
    surface([x, y, z], [0, 0, d], [0, h, 0], color);
    surface([x + w, y, z], [0, 0, d], [0, h, 0], color);
    surface([x, y + h, z], [w, 0, 0], [0, 0, d], color);
  }
  surface([-2.5, 0, -2], [5, 0, 0], [0, 0, 4], [184, 177, 160]);
  surface([-2.5, 0, -2], [5, 0, 0], [0, 3, 0], [225, 228, 220]);
  surface([-2.5, 0, -2], [0, 0, 4], [0, 3, 0], [205, 214, 205]);
  box([-1.8, 0, -1.5], [2.1, 0.65, 0.85], [61, 90, 80]);
  box([-1.8, 0.65, -1.5], [2.1, 0.45, 0.2], [52, 77, 68]);
  box([0.4, 0.05, -0.1], [1.1, 0.55, 0.75], [133, 104, 83]);
  box([1.5, 0, -1.7], [0.55, 1.4, 0.45], [149, 159, 149]);
  const name = 'generated-room.splat';
  return { name, blob: new Blob([encodeSampleSplats(splats)], { type: 'application/octet-stream' }), metadata: null, kind: 'generated' };
}
