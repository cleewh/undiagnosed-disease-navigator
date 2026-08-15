import { useState } from "react";

// Compact MDT "roster" centrepiece: a dense strip of specialist portrait cards
// (each ringed by their live vote stance, dimmed when away) alongside a compact
// consensus dial. Replaces the round-table layout to avoid dead space. Portraits
// are realistic stock stand-ins (not the real team); each falls back to initials
// if the image cannot load.

type Tone = "info" | "warning" | "success" | "neutral" | "danger";
type Stance = "support" | "conditional" | "oppose" | "abstain";

export interface BoardSeat {
  readonly id: string;
  readonly label: string;
  readonly initials: string;
  readonly accent: string;
  readonly photo: string;
  readonly stance: Stance;
  readonly present: boolean;
  readonly isMe: boolean;
}

const STANCE_COLOR: Record<Stance, string> = {
  support: "#22c55e",
  conditional: "#f59e0b",
  oppose: "#ef4444",
  abstain: "#94a3b8"
};

const STANCE_LABEL: Record<Stance, string> = {
  support: "Support",
  conditional: "Conditional",
  oppose: "Oppose",
  abstain: "Abstain"
};

const STANCE_TONE: Record<Stance, Tone> = {
  support: "success",
  conditional: "warning",
  oppose: "danger",
  abstain: "neutral"
};

function RosterAvatar({ seat }: { readonly seat: BoardSeat }) {
  const [ok, setOk] = useState(true);
  const ring = STANCE_COLOR[seat.stance];
  return (
    <span className="roster-avatar" style={{ background: seat.accent, borderColor: ring }}>
      <span className="roster-avatar__initials">{seat.initials}</span>
      {ok && (
        <img className="roster-avatar__img" src={seat.photo} alt="" loading="lazy" onError={() => setOk(false)} />
      )}
      <span className={`roster-avatar__dot roster-avatar__dot--${seat.present ? "on" : "off"}`} aria-hidden="true" />
    </span>
  );
}

function ConsensusDial({ backing, total }: { readonly backing: number; readonly total: number }) {
  const r = 46;
  const circ = 2 * Math.PI * r;
  const pct = total > 0 ? backing / total : 0;
  return (
    <svg className="consensus-dial" viewBox="0 0 120 120" role="img" aria-label={`Consensus: ${backing} of ${total} back the motion (${Math.round(pct * 100)} percent).`}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="#1f2d4a" strokeWidth="12" />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke="#22c55e"
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={`${(circ * pct).toFixed(1)} ${circ.toFixed(1)}`}
        transform="rotate(-90 60 60)"
      />
      <text x="60" y="58" textAnchor="middle" fontSize="26" fontWeight="800" fill="#e2e8f0">{Math.round(pct * 100)}%</text>
      <text x="60" y="76" textAnchor="middle" fontSize="9" fill="#93a4c4" letterSpacing="0.08em">CONSENSUS</text>
    </svg>
  );
}

export function BoardTable({
  seats,
  backing,
  total
}: {
  readonly seats: readonly BoardSeat[];
  readonly backing: number;
  readonly total: number;
}) {
  const present = seats.filter((s) => s.present).length;
  return (
    <div className="board-roster-panel">
      <div className="board-roster-panel__consensus">
        <ConsensusDial backing={backing} total={total} />
        <span className="board-roster-panel__meta">{backing}/{total} backing · {present} present</span>
      </div>
      <ul className="board-roster" aria-label="MDT members and vote stance">
        {seats.map((s) => (
          <li key={s.id} className={s.present ? "roster-card roster-card--present" : "roster-card roster-card--away"}>
            <RosterAvatar seat={s} />
            <span className="roster-card__name">{s.label}{s.isMe ? " (you)" : ""}</span>
            <span className={`pill pill--${STANCE_TONE[s.stance]}`}>{STANCE_LABEL[s.stance]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type { Tone };
