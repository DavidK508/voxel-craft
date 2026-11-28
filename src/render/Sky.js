import * as THREE from 'three';
import { SimplexNoise, mulberry32 } from '../shared/noise.js';
import { SUN_AXIS_X, SUN_AXIS_Z } from '../shared/constants.js';

const skyVertex = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w;
  }
`;

const skyFragment = /* glsl */`
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uMoonDir;
  uniform float uStars;
  uniform float uDaylight;
  uniform float uTime;
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    vec3 color = mix(uHorizon, uTop, smoothstep(0.0, 0.62, h));
    color = mix(uBottom, color, smoothstep(-0.22, 0.02, h));

    // Minecraft's sun and moon are flat square textures, not round discs.
    // Project the view ray onto the tangent plane of each body and cut a
    // hard-edged square out of it instead of smoothing a spherical dot.
    vec3 sunDir = normalize(uSunDir);
    vec3 sunRef = abs(sunDir.y) > 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vec3 sunRight = normalize(cross(sunDir, sunRef));
    vec3 sunUp = cross(sunRight, sunDir);
    float sunDot = dot(dir, sunDir);
    float sunSquare = (1.0 - smoothstep(0.020, 0.022, max(abs(dot(dir, sunRight)), abs(dot(dir, sunUp)))))
      * step(0.999, sunDot);
    float glow = pow(max(sunDot, 0.0), 18.0) * 0.35;
    color += uSunColor * (sunSquare * 1.6 + glow);

    vec3 moonDir = normalize(uMoonDir);
    vec3 moonRef = abs(moonDir.y) > 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vec3 moonRight = normalize(cross(moonDir, moonRef));
    vec3 moonUp = cross(moonRight, moonDir);
    float moonDot = dot(dir, moonDir);
    float moonSquare = (1.0 - smoothstep(0.014, 0.016, max(abs(dot(dir, moonRight)), abs(dot(dir, moonUp)))))
      * step(0.9995, moonDot);
    color += vec3(0.72, 0.8, 0.95) * moonSquare * (1.0 - uDaylight) * 1.4;

    if (uStars > 0.01 && h > -0.05) {
      vec3 cell = floor(dir * 420.0);
      float star = hash(cell);
      if (star > 0.9975) {
        float twinkle = 0.55 + 0.45 * sin(uTime * 2.3 + (cell.x + cell.y + cell.z) * 12.0);
        color += vec3(0.8, 0.9, 1.0) * uStars * twinkle * smoothstep(-0.05, 0.3, h);
      }
    }

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Pixel cells of 4x4 texels: Minecraft's clouds are flat squares, not fog. */
export const CLOUD_CELL = 4;

function makeCloudTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const noise = new SimplexNoise(0x8c10d);
  const image = ctx.createImageData(size, size);
  const cells = size / CLOUD_CELL;
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      // Sample once per cell, then paint the whole square with one opacity.
      const sx = cx * CLOUD_CELL + CLOUD_CELL / 2;
      const sy = cy * CLOUD_CELL + CLOUD_CELL / 2;
      const n = noise.fbm2(sx * 0.045, sy * 0.045, 5, 2, 0.5);
      const n2 = noise.fbm2(sx * 0.012 + 30, sy * 0.012 - 10, 3, 2, 0.5);
      const value = n * 0.65 + n2 * 0.35;
      const alpha = value > 0.12 ? 210 : 0;
      for (let dy = 0; dy < CLOUD_CELL; dy++) {
        for (let dx = 0; dx < CLOUD_CELL; dx++) {
          const index = ((cy * CLOUD_CELL + dy) * size + cx * CLOUD_CELL + dx) * 4;
          image.data[index] = 255;
          image.data[index + 1] = 255;
          image.data[index + 2] = 255;
          image.data[index + 3] = alpha;
        }
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.uniforms = {
      uTop: { value: new THREE.Color(0x3a83c7) },
      uHorizon: { value: new THREE.Color(0xa9d5ea) },
      uBottom: { value: new THREE.Color(0x6d8b78) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2).normalize() },
      uSunColor: { value: new THREE.Color(0xffe7b0) },
      uMoonDir: { value: new THREE.Vector3(-0.4, -0.8, -0.2).normalize() },
      uStars: { value: 0 },
      uDaylight: { value: 1 },
      uTime: { value: 0 },
    };

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 20), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);

    const cloudMaterial = new THREE.MeshBasicMaterial({
      map: makeCloudTexture(),
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      color: 0xffffff,
    });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), cloudMaterial);
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.position.y = 172;
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = 2;
    scene.add(this.clouds);

    this.fogColor = new THREE.Color();
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.time = 0;
  }

  update(camera, timeOfDay, dt) {
    this.time += dt;
    // Minecraft clock: t=0 is 06:00 (sunrise), t=6000 is noon, t=12000 is
    // 18:00 (sunset), t=18000 is midnight. formatClock() adds the same 6h
    // offset, so the sun must start at the horizon at t=0 with no extra shift.
    const angle = (timeOfDay / 24000) * Math.PI * 2;
    const sunY = Math.sin(angle);
    const sunX = Math.cos(angle) * SUN_AXIS_X;
    const sunZ = Math.cos(angle) * SUN_AXIS_Z;
    this.sunDir.set(sunX, sunY, sunZ).normalize();
    this.moonDir.copy(this.sunDir).multiplyScalar(-1);

    const day = THREE.MathUtils.smoothstep(sunY, -0.18, 0.25);
    const dawn = Math.max(0, 1 - Math.abs(sunY) * 4) * (1 - Math.abs(sunX) * 0.2);
    const top = new THREE.Color(0x071021).lerp(new THREE.Color(0x3a83c7), day);
    const horizon = new THREE.Color(0x111d2d).lerp(new THREE.Color(0xa9d5ea), day);
    horizon.lerp(new THREE.Color(0xf0a26a), dawn * 0.55);
    const bottom = new THREE.Color(0x101820).lerp(new THREE.Color(0x8ba78e), day);

    this.uniforms.uTop.value.copy(top);
    this.uniforms.uHorizon.value.copy(horizon);
    this.uniforms.uBottom.value.copy(bottom);
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uMoonDir.value.copy(this.moonDir);
    this.uniforms.uStars.value = 1 - day;
    this.uniforms.uDaylight.value = day;
    this.uniforms.uTime.value = this.time;

    this.fogColor.copy(horizon);

    this.mesh.position.copy(camera.position);
    this.clouds.position.x = camera.position.x;
    this.clouds.position.z = camera.position.z;
    this.clouds.material.opacity = 0.28 + day * 0.3;
    this.clouds.material.map.offset.x = (this.time * 0.0022) % 1;
    this.clouds.material.map.offset.y = (this.time * 0.0009) % 1;

    return {
      daylight: day,
      fogColor: this.fogColor,
      sunDir: this.sunDir,
    };
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.clouds.geometry.dispose();
    this.clouds.material.map.dispose();
    this.clouds.material.dispose();
  }
}
