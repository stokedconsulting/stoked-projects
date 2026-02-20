export function generateSparkline(): string {
  const points = Array.from({ length: 10 }, () => Math.floor(Math.random() * 20));
  const path = points.map((p, i) => `${i * 6},${20 - p}`).join(' L');
  return `M${path}`;
}
