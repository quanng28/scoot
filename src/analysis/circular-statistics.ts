const wrap = (degrees: number): number => ((degrees + 180) % 360 + 360) % 360 - 180;

/** Circular median for a single observed angular cluster. Ambiguous semicircles stay unavailable. */
export function circularMedianDegrees(values: readonly number[]): number | null {
  const anchor = values[0];
  if (anchor === undefined || values.some((value) => !Number.isFinite(value))) return null;
  const unwrapped = values.map((value) => anchor + wrap(value - anchor)).sort((a, b) => a - b);
  const first = unwrapped[0]!, last = unwrapped.at(-1)!;
  if (last - first >= 180) return null;
  return wrap((unwrapped[Math.floor((unwrapped.length - 1) / 2)]! + unwrapped[Math.floor(unwrapped.length / 2)]!) / 2);
}
