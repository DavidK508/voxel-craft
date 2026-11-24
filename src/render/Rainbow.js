import * as THREE from 'three';

const BANDS = [
  0xff4d6d, 0xff9f43, 0xffe066, 0x8ce99a,
  0x74c0fc, 0xb197fc, 0xf783ac,
];
const SEGMENTS = 48;
const INNER_RADIUS = 58;
const OUTER_RADIUS = 72;
const CENTER_Y = -58;
const DISTANCE = 150;
const RAIN_MEMORY = 1.4;
// The arc hangs at this fixed compass bearing from the player instead of
// following the look direction, so turning the head never drags it along.
export const RAINBOW_ANCHOR = Object.freeze({ x: 0.6, y: 0, z: -0.8 });

const vertexShader = /* glsl */`
  attribute vec3 color;
  attribute float aGlow;
  varying vec3 vColor;
  varying float vGlow;
  void main() {
    vColor = color;
    vGlow = aGlow;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vGlow;
  void main() {
    float alpha = uOpacity * (0.42 + vGlow * 0.58);
    gl_FragColor = vec4(vColor * (0.7 + vGlow * 0.5), alpha);
    #include <colorspace_fragment>
  }
`;

function buildArc() {
  const positions = [];
  const colors = [];
  const glows = [];
  const color = new THREE.Color();
  const bandWidth = (OUTER_RADIUS - INNER_RADIUS) / BANDS.length;

  for (let band = 0; band < BANDS.length; band++) {
    // A slim gap between bands keeps the arc readable without any texture.
    const outer = OUTER_RADIUS - band * bandWidth - 0.22;
    const inner = OUTER_RADIUS - (band + 1) * bandWidth + 0.22;
    color.setHex(BANDS[band]);
    for (let segment = 0; segment < SEGMENTS; segment++) {
      const a0 = (segment / SEGMENTS) * Math.PI;
      const a1 = ((segment + 1) / SEGMENTS) * Math.PI;
      const points = [
        [outer, a0, 0.72], [inner, a0, 1], [outer, a1, 0.72],
        [outer, a1, 0.72], [inner, a0, 1], [inner, a1, 1],
      ];
      for (const [radius, angle, glow] of points) {
        positions.push(Math.cos(angle) * radius, CENTER_Y + Math.sin(angle) * radius, 0);
        colors.push(color.r, color.g, color.b);
        glows.push(glow);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aGlow', new THREE.Float32BufferAttribute(glows, 1));
  return geometry;
}

/**
 * A soft spectrum that lingers for a moment after rain. It is anchored at a
 * fixed world bearing ahead of the player and stays perfectly upright, so
 * looking around never swings the arc along with the head. Additive, unlit
 * and depth-tested, so terrain still occludes it.
 */
export class Rainbow {
  constructor(scene) {
    this.geometry = buildArc();
    this.material = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.rainTimer = 0;
    this.opacity = 0;
  }

  update(camera, weatherMode, daylight, dt) {
    if (weatherMode === 'rain') this.rainTimer = RAIN_MEMORY;
    else this.rainTimer = Math.max(0, this.rainTimer - dt);

    const sun = THREE.MathUtils.clamp((daylight - 0.18) / 0.5, 0, 1);
    const afterglow = THREE.MathUtils.clamp(this.rainTimer / 0.9, 0, 1);
    const target = this.rainTimer > 0 ? 0.62 * sun * afterglow : 0;
    this.opacity += (target - this.opacity) * Math.min(1, dt * 2.2);
    if (this.opacity < 0.005 && target === 0) this.opacity = 0;

    this.mesh.visible = this.opacity > 0.005;
    this.material.uniforms.uOpacity.value = this.opacity;
    if (!this.mesh.visible || !camera) return;

    // Position follows the player's body, never the head: the bearing to the
    // arc stays constant while yaw/pitch only decide whether it is on screen.
    this.mesh.position.copy(camera.position).addScaledVector(RAINBOW_ANCHOR, DISTANCE);
    // Upright with yaw only, always turned towards the player.
    this.mesh.rotation.set(
      0,
      Math.atan2(camera.position.x - this.mesh.position.x, camera.position.z - this.mesh.position.z),
      0,
    );
  }

  reset() {
    this.rainTimer = 0;
    this.opacity = 0;
    this.material.uniforms.uOpacity.value = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
