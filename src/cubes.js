import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/*
  All ~100 cubes are one InstancedMesh: one draw call. Each instance carries its colour and two
  numbers: `white`, how far its colour is pulled toward white, and `glow`, how much of that colour
  it gives off as light — so a struck cube doesn't just get lit, it becomes the light, and bloom
  picks it up. At 0 and 0 it is a plain, slightly rough painted block. The two are separate so the
  display modes can drive them differently: PAINTED whitens with the glow, DARK whitens with
  distance thrown.
*/

export class Cubes {
  constructor(pieces, parent) {
    const geo = new RoundedBoxGeometry(1, 1, 1, 3, 0.06);
    this.glow = new Float32Array(pieces.length);
    this.glowAttr = new THREE.InstancedBufferAttribute(this.glow, 1);
    this.glowAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aGlow', this.glowAttr);
    this.white = new Float32Array(pieces.length);
    this.whiteAttr = new THREE.InstancedBufferAttribute(this.white, 1);
    this.whiteAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aWhite', this.whiteAttr);

    const mat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.05 });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aGlow;\nattribute float aWhite;\nvarying float vGlow;\nvarying float vWhite;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;\nvWhite = aWhite;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGlow;\nvarying float vWhite;')
        .replace(
          '#include <emissivemap_fragment>',
          [
            '#include <emissivemap_fragment>',
            'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vWhite);',
            'totalEmissiveRadiance += diffuseColor.rgb * vGlow * 1.5;',
          ].join('\n'),
        );
    };

    this.mesh = new THREE.InstancedMesh(geo, mat, pieces.length);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.base = pieces.map((p) => new THREE.Color(p.color));
    pieces.forEach((p, i) => this.mesh.setColorAt(i, this.base[i]));
    parent.add(this.mesh);

    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.qd = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.axis = new THREE.Vector3();
  }

  // Put the painted colours back (after DARK mode drew its own).
  restore() {
    this.base.forEach((c, i) => this.mesh.setColorAt(i, c));
    this.mesh.instanceColor.needsUpdate = true;
  }

  setColors(colors) {
    colors.forEach((c, i) => {
      this.base[i].set(c);
      this.mesh.setColorAt(i, this.base[i]);
    });
    this.mesh.instanceColor.needsUpdate = true;
  }

  // `display` (optional): per-cube colours for this frame, leaving the painted base untouched.
  update(pieces, physics, glow, white, display = null) {
    const { u, th } = physics;
    for (let i = 0; i < pieces.length; i++) {
      const pc = pieces[i];
      const o = i * 3;
      this.p.set(pc.rest.x + u[o], pc.rest.y + u[o + 1], pc.rest.z + u[o + 2]);
      const angle = Math.hypot(th[o], th[o + 1], th[o + 2]);
      if (angle > 1e-6) {
        this.axis.set(th[o] / angle, th[o + 1] / angle, th[o + 2] / angle);
        this.qd.setFromAxisAngle(this.axis, angle);
        this.q.copy(this.qd).multiply(pc.restQuat);
      } else this.q.copy(pc.restQuat);
      this.s.setScalar(pc.scale);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.glow[i] = glow[i];
      this.white[i] = white[i];
      if (display) this.mesh.setColorAt(i, display[i]);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.glowAttr.needsUpdate = true;
    this.whiteAttr.needsUpdate = true;
    if (display) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
