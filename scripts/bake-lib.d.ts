export declare function makeXorshift(seedInit: number): () => number;

export declare function transformPoint(
  m: number[],
  x: number,
  y: number,
  z: number
): [number, number, number];

export declare function normalizePoints(
  positions: Float32Array,
  targetRadius?: number
): { center: [number, number, number]; scale: number };

export declare function sampleSurface(options: {
  positions: Float32Array;
  indices: Uint32Array;
  count: number;
  seed?: number;
}): { positions: Float32Array; normals: Float32Array };
