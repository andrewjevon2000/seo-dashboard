/**
 * Dependency-free SVG sparkline. Used in each table row (hundreds of them), so
 * it deliberately avoids a charting library — pure SVG keeps the list light.
 */
export function Sparkline({
  values,
  width = 96,
  height = 24,
  strokeClass = "stroke-accent",
}: {
  values: number[];
  width?: number;
  height?: number;
  strokeClass?: string;
}) {
  if (values.length === 0) {
    return <span className="text-[11px] text-muted">—</span>;
  }
  if (values.length === 1) {
    return (
      <svg width={width} height={height} aria-hidden>
        <circle cx={width / 2} cy={height / 2} r={2} className="fill-accent" />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;
  const stepX = (width - pad * 2) / (values.length - 1);

  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (height - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });

  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const rising = values[values.length - 1] >= values[0];

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      <path d={d} fill="none" strokeWidth={1.5} className={strokeClass} />
      <circle
        cx={last[0]}
        cy={last[1]}
        r={2}
        className={rising ? "fill-good" : "fill-bad"}
      />
    </svg>
  );
}
