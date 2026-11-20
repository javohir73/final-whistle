"use client";

import { useState } from "react";
import { useTimezone, detectTimezone } from "@/lib/useTimezone";
import { tzCityLabel } from "@/lib/datetime";
import { Button } from "@/components/ui";

/** Curated list of IANA timezones grouped by region, for the change dropdown. */
const TIMEZONES: { group: string; zones: [string, string][] }[] = [
  {
    group: "Host countries",
    zones: [
      ["America/Los_Angeles", "Los Angeles / Vancouver / Seattle"],
      ["America/Denver", "Denver"],
      ["America/Chicago", "Dallas / Houston / Kansas City"],
      ["America/New_York", "New York / Toronto / Miami / Atlanta"],
      ["America/Mexico_City", "Mexico City / Guadalajara / Monterrey"],
    ],
  },
  {
    group: "Americas",
    zones: [
      ["America/Sao_Paulo", "São Paulo / Buenos Aires"],
      ["America/Bogota", "Bogotá / Lima"],
      ["America/Halifax", "Halifax"],
    ],
  },
  {
    group: "Europe & Africa",
    zones: [
      ["Europe/London", "London / Lisbon / Dublin"],
      ["Europe/Paris", "Paris / Berlin / Madrid / Rome"],
      ["Europe/Athens", "Athens / Cairo / Johannesburg"],
      ["Europe/Moscow", "Moscow / Istanbul / Riyadh"],
      ["Africa/Lagos", "Lagos / Algiers"],
    ],
  },
  {
    group: "Asia & Pacific",
    zones: [
      ["Asia/Dubai", "Dubai"],
      ["Asia/Tehran", "Tehran"],
      ["Asia/Tashkent", "Tashkent"],
      ["Asia/Karachi", "Karachi / Islamabad"],
      ["Asia/Kolkata", "Mumbai / Delhi"],
      ["Asia/Bangkok", "Bangkok / Jakarta"],
      ["Asia/Shanghai", "Beijing / Singapore"],
      ["Asia/Tokyo", "Tokyo / Seoul"],
      ["Australia/Sydney", "Sydney"],
      ["Pacific/Auckland", "Auckland"],
      ["UTC", "UTC"],
    ],
  },
];

function Select({
  value,
  onChange,
}: {
  value: string;
  onChange: (tz: string) => void;
}) {
  // Ensure the current value and the auto-detected zone are always selectable,
  // even if they aren't in the curated list.
  const inList = (id: string) => TIMEZONES.some((g) => g.zones.some(([z]) => z === id));
  const extras = [value, detectTimezone()].filter(
    (id, i, arr) => id && !inList(id) && arr.indexOf(id) === i,
  );
  return (
    <select
      id="timezone-select"
      name="timezone"
      aria-label="Choose your timezone"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-[44px] min-w-0 flex-1 rounded-input border border-line-strong bg-ground px-3 text-notes font-medium text-ink focus-visible:border-brand sm:flex-none"
    >
      {extras.length > 0 && (
        <optgroup label="Detected">
          {extras.map((id) => (
            <option key={id} value={id}>
              {tzCityLabel(id)}
            </option>
          ))}
        </optgroup>
      )}
      {TIMEZONES.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.zones.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** First-visit banner that asks the user to confirm or change their location,
 *  then collapses into a compact "times shown in …" control. */
export function LocationPicker() {
  const { tz, confirmed, hydrated, setTimezone, confirm } = useTimezone();
  const [editing, setEditing] = useState(false);

  if (!hydrated) {
    // Reserve space to avoid layout shift before localStorage hydrates.
    return <div className="h-[58px]" aria-hidden />;
  }

  if (!confirmed) {
    return (
      <div className="flex flex-col gap-3 rounded-card border border-line bg-ground px-4 py-4 sm:flex-row sm:items-center sm:justify-between min-[900px]:px-7">
        <div className="flex items-center gap-3 text-notes">
          <PinIcon className="h-5 w-5 shrink-0 text-muted" />
          <span className="text-muted">
            Kick-off times in your local time,{" "}
            <span className="font-semibold text-ink">{tzCityLabel(tz)}</span>. Not right?
          </span>
        </div>
        <div className="flex w-full items-center gap-3 sm:w-auto">
          <Select value={tz} onChange={setTimezone} />
          <Button size="sm" onClick={confirm} className="shrink-0">
            Use this
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-notes text-muted">
      <PinIcon className="h-4 w-4 text-muted" />
      {editing ? (
        <Select
          value={tz}
          onChange={(t) => {
            setTimezone(t);
            setEditing(false);
          }}
        />
      ) : (
        <>
          <span>
            Times in <span className="font-semibold text-ink">{tzCityLabel(tz)}</span>
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-h-[44px] px-2 font-semibold text-brand underline-offset-[3px] hover:underline"
          >
            Change
          </button>
        </>
      )}
    </div>
  );
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 21s-7-5.2-7-11a7 7 0 1 1 14 0c0 5.8-7 11-7 11Z" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
