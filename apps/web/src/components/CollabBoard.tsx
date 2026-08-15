import { useState } from "react";
import { ROLES } from "../auth/roles.js";
import { useAuth } from "../auth/AuthContext.js";

// Collaborative review board (DEMONSTRATION). Shows specialist "presence" and a
// threaded comment stream for co-review of the case. This build is entirely
// session-local: presence is simulated from the role model and comments live in
// component state (they reset on reload). A production build would back this
// with a realtime service (e.g. AWS AppSync subscriptions or API Gateway
// WebSocket + DynamoDB) behind authentication — deliberately not deployed here
// to avoid a public, world-reachable endpoint and always-on cost.

type Tone = "info" | "warning" | "success" | "neutral" | "danger";

interface Comment {
  readonly id: string;
  readonly author: string;
  readonly role: string;
  readonly initials: string;
  readonly accent: string;
  readonly when: string;
  readonly body: string;
  readonly tone: Tone;
}

// Simulated presence: which specialists are "in the room".
const PRESENCE = ROLES.slice(0, 5).map((r, i) => ({
  id: r.id,
  name: r.sampleName,
  initials: r.initials,
  accent: r.accent,
  status: i < 3 ? ("online" as const) : ("away" as const)
}));

const SEED_COMMENTS: readonly Comment[] = [
  {
    id: "c1",
    author: "Dr. Ada Okonkwo",
    role: "Clinical geneticist",
    initials: "AO",
    accent: "#2563eb",
    when: "09:02",
    body: "Phenotype set is solid — regression plus acquired microcephaly really points at MECP2. Happy to chair disclosure once segregation is back.",
    tone: "info"
  },
  {
    id: "c2",
    author: "Dr. Ravi Menon",
    role: "Bioinformatician",
    initials: "RM",
    accent: "#0e7490",
    when: "09:05",
    body: "c.502C>T is a clean stop-gained, absent from gnomAD, CADD 36. PVS1 applies. De novo is assumed, not yet confirmed.",
    tone: "warning"
  },
  {
    id: "c3",
    author: "Ms. Lena Farah",
    role: "Genetic counsellor",
    initials: "LF",
    accent: "#7c3aed",
    when: "09:08",
    body: "External-matching consent is still pending with the family — I'll chase before we rely on any cohort matches.",
    tone: "danger"
  }
];

export function CollabBoard() {
  const { session, role } = useAuth();
  const [comments, setComments] = useState<readonly Comment[]>(SEED_COMMENTS);
  const [draft, setDraft] = useState("");

  const authorName = session?.name ?? role?.sampleName ?? "You";
  const authorRole = role?.label ?? "Reviewer";
  const authorInitials = role?.initials ?? "You";
  const authorAccent = role?.accent ?? "#334155";

  const post = () => {
    const body = draft.trim();
    if (!body) return;
    const now = new Date();
    const when = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    setComments((prev) => [
      ...prev,
      {
        id: `c${prev.length + 1}-${now.getTime()}`,
        author: authorName,
        role: authorRole,
        initials: authorInitials,
        accent: authorAccent,
        when,
        body,
        tone: "neutral"
      }
    ]);
    setDraft("");
  };

  const onlineCount = PRESENCE.filter((p) => p.status === "online").length;

  return (
    <section className="card collab" aria-label="Collaborative review board" data-testid="collab-board">
      <div className="collab__head">
        <h2 className="card__title">Live co-review</h2>
        <span className="pill pill--success">{onlineCount} online</span>
      </div>
      <p className="card__subtitle">
        Presence and comments for board co-review. Demonstration build — session-local; a production
        deployment would use a realtime backend behind authentication.
      </p>

      <ul className="collab__presence" aria-label="Specialists present">
        {PRESENCE.map((p) => (
          <li key={p.id} className="collab__avatar-wrap" title={`${p.name} · ${p.status}`}>
            <span className="collab__avatar" style={{ backgroundColor: p.accent }}>
              {p.initials}
            </span>
            <span className={`collab__dot collab__dot--${p.status}`} aria-hidden="true" />
            <span className="visually-hidden">{p.name} is {p.status}</span>
          </li>
        ))}
      </ul>

      <ol className="collab__thread">
        {comments.map((c) => (
          <li key={c.id} className="collab__comment">
            <span className="collab__avatar collab__avatar--sm" style={{ backgroundColor: c.accent }}>
              {c.initials}
            </span>
            <div className="collab__bubble">
              <p className="collab__meta">
                <span className="collab__author">{c.author}</span>
                <span className="collab__role">{c.role}</span>
                <time className="collab__time">{c.when}</time>
              </p>
              <p className="collab__body">{c.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <form
        className="collab__form"
        onSubmit={(e) => {
          e.preventDefault();
          post();
        }}
      >
        <label htmlFor="collab-input" className="visually-hidden">Add a comment to the board</label>
        <input
          id="collab-input"
          className="collab__input"
          type="text"
          value={draft}
          placeholder={`Comment as ${authorRole}…`}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={!draft.trim()}>Post</button>
      </form>
    </section>
  );
}
