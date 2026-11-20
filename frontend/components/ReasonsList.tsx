/** "Why this prediction" list (explainable AI): each reason is a two-column
 *  marker+text row.
 *
 *  `reasons` are plain strings with no polarity, and some of them argue AGAINST
 *  the model's pick. The marker is therefore a neutral muted bullet -- a green
 *  "+" on every row claimed every line supported the call. When reasons carry a
 *  `favors` side this can split into for/against. Pure server component. */
export function ReasonsList({ reasons }: { reasons: string[] }) {
  return (
    <ul className="flex flex-col gap-[7px]">
      {reasons.map((r, i) => (
        <li key={i} className="flex gap-[9px]">
          <span className="font-bold text-muted" aria-hidden>
            •
          </span>
          <span className="leading-[1.5] text-ink">{r}</span>
        </li>
      ))}
    </ul>
  );
}
