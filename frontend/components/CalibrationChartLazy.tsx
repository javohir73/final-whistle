"use client";

import dynamic from "next/dynamic";
import type { ReliabilityBin } from "@/components/CalibrationChart";

/** CalibrationChart draws into a fixed 300px box; the skeleton reserves the
 *  same height so the page doesn't shift when the chart arrives. */
const CHART_HEIGHT = 300;

const CalibrationChart = dynamic(
  () => import("@/components/CalibrationChart").then((m) => m.CalibrationChart),
  {
    ssr: false,
    loading: () => <div className="skeleton w-full rounded-xl" style={{ height: CHART_HEIGHT }} />,
  },
);

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The reliability chart, off the critical path. recharts (~98 kB gzip with
 *  lodash) made /methodology and /record the heaviest static pages; it now
 *  loads after hydration (next/dynamic, ssr:false), behind a same-size
 *  skeleton. This wrapper is the client boundary next/dynamic needs --
 *  /methodology is an async server page, where ssr:false isn't allowed.
 *
 *  The SVG is decorative for assistive tech; the bins are rendered into the
 *  server HTML as an sr-only table, so the data is readable before (and
 *  without) the chart's JavaScript. */
export function CalibrationChartLazy({ bins }: { bins: ReliabilityBin[] }) {
  return (
    <>
      <div aria-hidden="true">
        <CalibrationChart bins={bins} />
      </div>
      <table className="sr-only">
        <caption>Calibration: how often each predicted probability actually happened</caption>
        <thead>
          <tr>
            <th scope="col">Predicted</th>
            <th scope="col">Actually happened</th>
            <th scope="col">Forecasts</th>
          </tr>
        </thead>
        <tbody>
          {bins.map((b) => (
            <tr key={`${b.mean_predicted}-${b.count}`}>
              <td>{pct(b.mean_predicted)}</td>
              <td>{pct(b.empirical_freq)}</td>
              <td>{b.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
