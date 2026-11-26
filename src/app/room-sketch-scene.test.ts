import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildRoomGeometry } from '../lib/room-geometry';
import { createPhotoRoomScene } from './room-sketch-scene';

const room = buildRoomGeometry({ mode: 'arkit', floorY: 0, outline: { closed: true, points: [[0, 0], [4, 0], [4, 4], [0, 4]] }, doors: [[2, 0]] })!;

describe('photo room dollhouse geometry', () => {
  it('changes which two walls are cut away after a 90 degree orbit; leaves the floor in place', () => {
    const model = createPhotoRoomScene(room, [], new Map(), () => {});
    const walls = model.group.children.filter((object) => object instanceof THREE.Group);
    expect(walls).toHaveLength(4);
    model.cutaway(new THREE.Vector3(8, 6, 8));
    const before = walls.map((wall) => wall.visible); expect(before).toEqual([true, false, false, true]);
    model.cutaway(new THREE.Vector3(-4, 6, 8));
    expect(walls.map((wall) => wall.visible)).toEqual([true, true, false, false]);
    expect(model.group.visible).toBe(true); model.dispose();
  });
  it('keeps poses-only geometry floor-only and uses at most two samplers per projection material', () => {
    const model = createPhotoRoomScene({ ...room, walls: [], floorOnly: true }, [], new Map(), () => {});
    expect(model.group.children.some((object) => object instanceof THREE.Group)).toBe(false);
    model.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      expect(object.material).toBeInstanceOf(THREE.ShaderMaterial);
      const material = object.material as THREE.ShaderMaterial;
      expect(Object.keys(material.uniforms).filter((key) => /^photo\d$/.test(key))).toHaveLength(2);
      const positions = object.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) expect(positions.getY(i)).toBe(0);
    });
    model.dispose();
  });
});
