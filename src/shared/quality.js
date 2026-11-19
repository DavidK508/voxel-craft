// Graphics quality switches. They can be forced from the command line for
// benchmarking or debugging:
//   VOXELCRAFT_LOWEND=1 npx electron .   (no MSAA, no mipmaps, 0.8x render)
//   VOXELCRAFT_NO_ANTIALIAS=1 ...
//   VOXELCRAFT_NO_MIPMAPS=1 ...
// A URL parameter with the same name wins over the defaults below.

const params = new URLSearchParams(location.search);

function flag(name, fallback) {
  const value = params.get(name);
  if (value === null) return fallback;
  return value === '1' || value === 'true';
}

export const QUALITY = {
  // MSAA quadruples the fill cost on old integrated GPUs (Haswell-era Intel
  // HD Graphics in particular). Pixel-art voxels already look sharp without
  // it, so it is off unless explicitly requested.
  antialias: flag('antialias', false),
  // One 16x16 tile per block: mipmaps average across the repeat seam and
  // draw bright/dark lines along every block edge, which reads as stripes.
  // Nearest filtering keeps the pixel art crisp and is much cheaper.
  mipmaps: flag('mipmaps', false),
  anisotropy: Number(params.get('anisotropy') ?? 1),
};
