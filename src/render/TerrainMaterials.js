import * as THREE from 'three';
import { QUALITY } from '../shared/quality.js';

const terrainVertex = /* glsl */`
  attribute float aTile;
  attribute float aAO;
  attribute float aSky;
  attribute vec2 aHorizon;
  attribute float aLight;
  varying vec2 vUv;
  flat varying float vTile;
  varying float vAO;
  varying float vSky;
  varying float vLight;
  varying vec2 vHorizon;
  varying vec3 vNormal;
  varying float vFogDepth;

  void main() {
    vUv = uv;
    vTile = aTile;
    vAO = aAO;
    vSky = aSky;
    vLight = aLight;
    vHorizon = aHorizon;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 mvPosition = viewMatrix * modelMatrix * vec4(position, 1.0);
    vFogDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const terrainFragment = /* glsl */`
  precision highp float;
  precision highp sampler2DArray;

  uniform sampler2DArray uAtlas;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbient;
  uniform float uDaylight;
  uniform float uTime;
  uniform float uWave;
  uniform float uOpacity;
  uniform float uAlphaTest;

  varying vec2 vUv;
  flat varying float vTile;
  varying float vAO;
  varying float vSky;
  varying float vLight;
  varying vec2 vHorizon;
  varying vec3 vNormal;
  varying float vFogDepth;

  out vec4 fragColor;

  void main() {
    vec2 sampleUv = vUv + vec2(uTime * 0.018 * uWave, uTime * 0.006 * uWave);
    vec4 tex = texture(uAtlas, vec3(sampleUv, vTile));
    if (tex.a < uAlphaTest) discard;

    vec3 n = normalize(vNormal);
    float faceShade = n.y > 0.5 ? 1.0 : (n.y < -0.5 ? 0.44 : 0.73);
    float sun = max(dot(n, uSunDir), 0.0);

    // Baked horizon along the sun's travel plane. The sun only ever moves in
    // the (SUN_AXIS, Y) plane, so the horizon toward sunrise or sunset is all
    // we need: terrain is lit while the sun climbs above it. This makes the
    // shadows stretch at dawn, shrink at noon and swap sides in the evening.
    float horizon = (uSunDir.x + uSunDir.z) >= 0.0 ? vHorizon.x : vHorizon.y;
    float sunVis = smoothstep(horizon - 0.03, horizon + 0.03, uSunDir.y);

    // Skylight baked per vertex by the mesher: 1 = open sky above, values
    // below that are ground under a roof, under a canopy or inside a cave.
    float skyAmbient = mix(0.35, 1.0, vSky);
    float ao = mix(0.42, 1.0, vAO);

    // One global day factor darkens night far more than the old 0.22 floor, so
    // midnight reads as night instead of a dim afternoon. Directional light
    // disappears once the sun is below the horizon. vSky fully blocks the
    // direct beam under a roof or canopy, while still allowing the softer
    // ambient skylight through.
    float day = mix(0.16, 1.0, uDaylight);
    // Baked block light (torches, glowstone, furnaces, lava, portals). It is
    // added after the daylight term so it still reads at night and in caves
    // instead of being swallowed by the global darkness factor.
    float blockLight = vLight * vLight;
    vec3 light = (uAmbient * 0.5 * skyAmbient
      + uSunColor * sunVis * vSky * (faceShade * 0.85 + sun * 0.15)) * day
      + vec3(1.0, 0.62, 0.28) * blockLight * mix(1.0, 0.45, uDaylight);
    vec3 color = tex.rgb * light * ao;

    float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
    color = mix(color, uFogColor, fogFactor);
    fragColor = linearToOutputTexel(vec4(color, tex.a * uOpacity));
  }
`;

export function createTextureArray(assets) {
  const texture = new THREE.DataArrayTexture(assets.data, assets.width, assets.height, assets.layers);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  if (QUALITY.mipmaps) {
    texture.minFilter = THREE.NearestMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = QUALITY.anisotropy;
  } else {
    // One 16x16 tile per block: mipmapping would average neighbouring tiles
    // across the repeat seam and draw lines along every block edge.
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = 1;
  }
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

export class TerrainMaterials {
  constructor(texture, renderDistance) {
    this.texture = texture;
    this.uniforms = {
      uAtlas: { value: texture },
      uFogColor: { value: new THREE.Color(0x9fc8e0) },
      uFogNear: { value: renderDistance * 16 * 0.5 },
      uFogFar: { value: renderDistance * 16 - 8 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2).normalize() },
      uSunColor: { value: new THREE.Color(0xfff2d0).convertSRGBToLinear() },
      uAmbient: { value: new THREE.Color(0x8ea4b4).convertSRGBToLinear() },
      uDaylight: { value: 1 },
      uTime: { value: 0 },
      uWave: { value: 0 },
      uOpacity: { value: 1 },
      uAlphaTest: { value: 0.5 },
    };

    this.solid = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: this.uniforms,
      vertexShader: terrainVertex,
      fragmentShader: terrainFragment,
      side: THREE.FrontSide,
      transparent: false,
      depthWrite: true,
    });

    this.waterUniforms = {
      ...this.uniforms,
      uWave: { value: 1 },
      uOpacity: { value: 0.76 },
      uAlphaTest: { value: 0.01 },
    };

    this.water = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: this.waterUniforms,
      vertexShader: terrainVertex,
      fragmentShader: terrainFragment,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });

    this.materials = [this.solid, this.water];
  }

  setRenderDistance(chunks) {
    this.uniforms.uFogNear.value = chunks * 16 * 0.48;
    this.uniforms.uFogFar.value = chunks * 16 - 6;
  }

  update({ fogColor, sunDir, daylight, time }) {
    this.uniforms.uFogColor.value.copy(fogColor).convertSRGBToLinear();
    this.uniforms.uSunDir.value.copy(sunDir);
    this.uniforms.uDaylight.value = daylight;
    this.uniforms.uTime.value = time;
  }

  dispose() {
    this.solid.dispose();
    this.water.dispose();
    this.texture.dispose();
  }
}
