"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ReliabilityBin {
  mean_predicted: number;
  empirical_freq: number;
  count: number;
}

/** Reliability (calibration) curve: predicted probability vs how often it
 *  actually happened. A perfectly calibrated model tracks the dashed y = x line. */
export function CalibrationChart({ bins }: { bins: ReliabilityBin[] }) {
  const data = bins.map((b) => ({
    predicted: Math.round(b.mean_predicted * 100),
    observed: Math.round(b.empirical_freq * 100),
    perfect: Math.round(b.mean_predicted * 100),
    count: b.count,
  }));
  const height = 300;

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 28, left: 4 }}>
          <CartesianGrid stroke="var(--fw-line-soft)" vertical={false} />
          <XAxis
            dataKey="predicted"
            type="number"
            domain={[0, 100]}
            tickCount={6}
            unit="%"
            tick={{ fontSize: 13, fill: "var(--fw-muted)" }}
            tickLine={false}
            label={{
              value: "Predicted probability",
              position: "insideBottom",
              offset: -12,
              style: { fill: "var(--fw-muted)", fontSize: 13 },
            }}
          />
          <YAxis
            domain={[0, 100]}
            tickCount={6}
            unit="%"
            tick={{ fontSize: 13, fill: "var(--fw-muted)" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "var(--fw-ground)",
              border: "1px solid var(--fw-line)",
              borderRadius: 12,
              boxShadow: "none",
              color: "var(--fw-ink)",
              fontSize: 13,
            }}
            labelStyle={{ color: "var(--fw-ink)", fontWeight: 600 }}
            formatter={(v: number, name: string) => [`${v}%`, name === "observed" ? "Actually happened" : "Perfect"]}
            labelFormatter={(v) => `Predicted ~${v}%`}
          />
          <Line
            type="monotone"
            dataKey="perfect"
            stroke="var(--fw-dash)"
            strokeDasharray="5 5"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="observed"
            stroke="var(--fw-brand)"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "var(--fw-brand)" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
