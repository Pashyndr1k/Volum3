import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/*
  All ~100 cubes are one InstancedMesh: one draw call. Each instance carries its colour and a
  `glow` value. Glow does two things in the shader: it pulls the surface colour toward white and
  it adds that colour as emission — so a struck cube doesn't just get lit, it becomes the light,
  and bloom picks it up. At glow 0 it is a plain, slightly rough painted block.
*/

export class Cubes {
  constructor(pieces, parent) {
    const geo = new RoundedBoxGeometry(1, 1, 1, 3, 0.06);
    this.glow = new Float32Array(pieces.length);
    this.glowAttr = new THREE.InstancedBufferAttribute(this.glow, 1);
    this.glowAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aGlow', this.glowAttr);

    const mat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.05 });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGlow;')
        .replace(
          '#include <emissivemap_fragment>',
          [
            '#include <emissivemap_fragment>',
            'vec3 hot = mix(diffuseColor.rgb, vec3(1.0), smoothstep(0.35, 1.0, vGlow));',
            'totalEmissiveRadiance += hot * vGlow * 1.5;',
            'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vGlow * 0.7);',
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

  setColors(colors) {
    colors.forEach((c, i) => {
      this.base[i].set(c);
      this.mesh.setColorAt(i, this.base[i]);
    });
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(pieces, physics, glow) {
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
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.glowAttr.needsUpdate = true;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
