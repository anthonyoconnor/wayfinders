function mix32(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

/** Stable coordinate-hashed value in the half-open range 0..1. */
export function seededValue(seed: number, x: number, y: number): number {
  const mixed = mix32(seed ^ Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495));
  return mixed / 0x1_0000_0000;
}
