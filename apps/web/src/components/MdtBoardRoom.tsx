import { useMemo, useState } from "react";
import { ROLES, type RoleId } from "../auth/roles.js";
import { useAuth } from "../auth/AuthContext.js";
import { CASE_SUMMARY } from "../data/reference.js";
import { recordRatification } from "../ai/mdtDecisions.js";
import { BoardTable, type BoardSeat } from "./BoardTable.js";
import { Icon } from "./icons.js";
import { VoiceNote } from "./VoiceNote.js";
import { CollabBoard } from "./CollabBoard.js";
import { AiCopilot, AiTaskPanel } from "./AiAssist.js";

// AI-facilitated MDT "board room" (DEMONSTRATION). Combines the human
// collaboration surface (presence + comments, voice capture) with an agentic
// facilitator layer: an agenda built from the case's open questions, tailored
// per-role pre-reads, a consensus/vote synthesizer, live minutes, auto-derived
// action items, and a grounded Bedrock "virtual specialist". Everything is
// session-local and non-diagnostic; the AI contributions are human-in-the-loop
// and reuse the existing Bedrock endpoint (no new infrastructure).

type Tone = "info" | "warning" | "success" | "neutral" | "danger";
type Stance = "support" | "conditional" | "oppose" | "abstain";

const MOTION =
  "Adopt Rett syndrome (MECP2 loss-of-function) as the working diagnosis, pending parental segregation and external-matching consent.";

const AGENDA: ReadonlyArray<{ item: string; tone: Tone }> = [
  { item: "Confirm working diagnosis: MECP2 c.502C>T (p.Arg168*) → Rett syndrome", tone: "info" },
  { item: "Parental segregation to confirm de novo status (PM6 → PS2)", tone: "warning" },
  { item: "External-matching consent (blocks Matchmaker / cohort matching)", tone: "danger" },
  { item: "Results disclosure and family counselling plan", tone: "info" },
  { item: "Seizure management and surveillance", tone: "neutral" }
];

const PRE_READS: Readonly<Record<RoleId, readonly string[]>> = {
  clinical_geneticist: [
    "Phenotype set confirmed (regression, acquired microcephaly, hand stereotypies, seizures).",
    "ACMG: PVS1 + PM6 + PM2 → Pathogenic. You chair the disclosure decision.",
    "Decision needed: adopt working diagnosis now vs await segregation."
  ],
  bioinformatician: [
    "Variant QC clean: DP 96x, alt fraction 0.49, GQ 99, FILTER PASS (GRCh37/hg19).",
    "Trio: proband 0/1, both parents 0/0 (well covered) → high de novo confidence.",
    "Action: order confirmatory parental segregation to upgrade PM6 → PS2."
  ],
  genetic_counsellor: [
    "Recurrence risk if de novo: low (~0.5-1%) but non-zero (germline mosaicism).",
    "External-matching consent still pending; secondary-findings consent opted in.",
    "Prepare reproductive-options and disclosure discussion for the family."
  ],
  medical_specialist: [
    "Neurodevelopmental picture fits; EEG multifocal epileptiform discharges.",
    "Lead seizure-management review; note PGx (HLA-B, CYP2C9/2C19) for AED choice.",
    "Contribute surveillance plan (growth, scoliosis, cardiac/QT)."
  ],
  researcher: [
    "Consistent with knowledge update KU-2025-014 (MECP2) that re-surfaced the case.",
    "Cohort / Matchmaker matching blocked until matching consent is obtained.",
    "Flag for episignature confirmation (EpiSign MECP2/RTT)."
  ],
  case_coordinator: [
    "Schedule the MDT decision and assign resulting action items.",
    "Track consent and segregation turnaround; unblock dependencies.",
    "Confirm family appointment for disclosure once agreed."
  ],
  administrator: [
    "Audit trail complete; AI contributions logged as suggested vs confirmed.",
    "Confirm access and governance policies enforced for this case.",
    "No configuration changes required for this review."
  ]
};

const SEED_POSITIONS: Readonly<Record<RoleId, { stance: Stance; rationale: string }>> = {
  clinical_geneticist: { stance: "support", rationale: "PVS1 plus a classic phenotype strongly support Rett; ready to chair disclosure." },
  bioinformatician: { stance: "conditional", rationale: "Support, conditional on parental segregation confirming de novo status." },
  genetic_counsellor: { stance: "conditional", rationale: "Support; matching consent pending and disclosure to be scheduled first." },
  medical_specialist: { stance: "support", rationale: "Clinical picture fits; will lead seizure management." },
  researcher: { stance: "support", rationale: "Consistent with the MECP2 knowledge update and literature." },
  case_coordinator: { stance: "abstain", rationale: "Non-clinical; will schedule and assign actions." },
  administrator: { stance: "abstain", rationale: "Governance only; audit trail complete." }
};

// Realistic stock placeholder portraits (randomuser.me, free to use),
// gender-matched to each specialist's name. These are illustrative stand-ins,
// not the real team and not real patient data. Fall back to initials on error.
const PORTRAITS: Readonly<Record<RoleId, string>> = {
  clinical_geneticist: "https://randomuser.me/api/portraits/women/44.jpg",
  bioinformatician: "https://randomuser.me/api/portraits/men/32.jpg",
  genetic_counsellor: "https://randomuser.me/api/portraits/women/68.jpg",
  medical_specialist: "https://randomuser.me/api/portraits/women/65.jpg",
  researcher: "https://randomuser.me/api/portraits/men/76.jpg",
  case_coordinator: "https://randomuser.me/api/portraits/men/52.jpg",
  administrator: "https://randomuser.me/api/portraits/men/85.jpg"
};

// Roles required to be present for a valid MDT quorum, and the roles allowed
// to chair (ratify) a decision.
const CORE_ROLES: readonly RoleId[] = ["clinical_geneticist", "bioinformatician", "genetic_counsellor"];
const CHAIR_ROLES: readonly RoleId[] = ["clinical_geneticist", "case_coordinator"];
// Simulated "in the room" set (matches the presence panel: first three roles),
// plus whoever is signed in.
const BASE_ONLINE: readonly RoleId[] = ["clinical_geneticist", "bioinformatician", "genetic_counsellor"];

const STANCE_META: Readonly<Record<Stance, { label: string; tone: Tone }>> = {
  support: { label: "Support", tone: "success" },
  conditional: { label: "Support (conditional)", tone: "warning" },
  oppose: { label: "Oppose", tone: "danger" },
  abstain: { label: "Abstain", tone: "neutral" }
};

interface ActionItem {
  readonly action: string;
  readonly owner: string;
  readonly tone: Tone;
}
const ACTION_ITEMS: readonly ActionItem[] = [
  { action: "Order parental segregation of the MECP2 variant", owner: "Bioinformatician", tone: "warning" },
  { action: "Obtain external-matching consent from the family", owner: "Genetic counsellor", tone: "danger" },
  { action: "Schedule results disclosure and counselling", owner: "Case coordinator", tone: "info" },
  { action: "Seizure-management and surveillance review", owner: "Medical specialist", tone: "neutral" }
];

const SEED_MINUTES: readonly string[] = [
  "Trio exome reviewed; MECP2 c.502C>T (p.Arg168*) accepted as the top candidate.",
  "Agreed to adopt Rett syndrome as the working (not final) diagnosis pending segregation and consent."
];

export function MdtBoardRoom() {
  const { role } = useAuth();
  const myRoleId = role?.id ?? "clinical_geneticist";
  const [previewRole, setPreviewRole] = useState<RoleId>(myRoleId);
  const [myVote, setMyVote] = useState<Stance | null>(null);
  const [minutes, setMinutes] = useState<ReadonlyArray<{ time: string; text: string }>>(
    SEED_MINUTES.map((text) => ({ time: "—", text }))
  );
  const [done, setDone] = useState<Readonly<Record<string, boolean>>>({});
  const [ratified, setRatified] = useState(false);

  const online = useMemo(() => new Set<RoleId>([...BASE_ONLINE, myRoleId]), [myRoleId]);
  const quorumMet = CORE_ROLES.every((r) => online.has(r));
  const isChair = CHAIR_ROLES.includes(myRoleId);

  const positions = useMemo(() => {
    const merged: Record<RoleId, { stance: Stance; rationale: string }> = { ...SEED_POSITIONS };
    if (myVote) {
      merged[myRoleId] = { stance: myVote, rationale: `${role?.sampleName ?? "You"} cast this position in-session.` };
    }
    return merged;
  }, [myVote, myRoleId, role]);

  const tally = useMemo(() => {
    const counts: Record<Stance, number> = { support: 0, conditional: 0, oppose: 0, abstain: 0 };
    (Object.keys(positions) as RoleId[]).forEach((id) => {
      counts[positions[id].stance] += 1;
    });
    return counts;
  }, [positions]);

  const total = ROLES.length;
  const backing = tally.support + tally.conditional;

  const seats: readonly BoardSeat[] = ROLES.map((r) => ({
    id: r.id,
    label: r.label,
    initials: r.initials,
    accent: r.accent,
    photo: PORTRAITS[r.id],
    stance: positions[r.id].stance,
    present: online.has(r.id),
    isMe: r.id === myRoleId
  }));
  const now = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const addMinute = (text: string) => setMinutes((prev) => [...prev, { time: now(), text }]);
  const toggle = (a: string) => setDone((p) => ({ ...p, [a]: !p[a] }));
  const completed = Object.values(done).filter(Boolean).length;

  const ratify = () => {
    if (!isChair || !quorumMet || ratified) return;
    recordRatification({
      decision: MOTION,
      outcome: "Ratified (working diagnosis)",
      rationale: `Board consensus: ${backing} of ${total} backing. Adopt as the working (not final) diagnosis; finalise only after de novo confirmation (parental segregation) and matching consent.`,
      chairLabel: role?.label ?? "Chair",
      actorId: `user:${myRoleId}-session`
    });
    addMinute(`Decision ratified by ${role?.sampleName ?? "chair"}: adopt Rett (MECP2) as the working diagnosis, pending segregation and consent.`);
    setRatified(true);
  };

  const exportMinutes = () => {
    if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return;
    const lines: string[] = [];
    lines.push("# UDN MDT MINUTES (SYNTHETIC — NON-DIAGNOSTIC)");
    lines.push(`Case: ${CASE_SUMMARY.caseId} · ${CASE_SUMMARY.proband} (${CASE_SUMMARY.demographics})`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");
    lines.push("## Motion");
    lines.push(MOTION);
    lines.push("");
    lines.push("## Agenda");
    AGENDA.forEach((a, i) => lines.push(`${i + 1}. ${a.item}`));
    lines.push("");
    lines.push("## Board positions");
    (Object.keys(positions) as RoleId[]).forEach((id) => {
      const r = ROLES.find((x) => x.id === id);
      const p = positions[id];
      lines.push(`- ${r?.label ?? id}: ${STANCE_META[p.stance].label} — ${p.rationale}`);
    });
    lines.push("");
    lines.push("## Consensus");
    lines.push(
      `${backing} of ${total} back the motion (support ${tally.support}, conditional ${tally.conditional}, oppose ${tally.oppose}, abstain ${tally.abstain}).`
    );
    lines.push("Adopt as the working (not final) diagnosis; conditions before finalising: confirm de novo status (parental segregation) and obtain external-matching consent.");
    lines.push("Key open question: is the MECP2 variant de novo?");
    lines.push("");
    lines.push("## Minutes");
    minutes.forEach((m) => lines.push(`[${m.time}] ${m.text}`));
    lines.push("");
    lines.push("## Action items");
    ACTION_ITEMS.forEach((a) => lines.push(`- [${done[a.action] ? "x" : " "}] ${a.action} — Owner: ${a.owner}`));
    lines.push("");
    lines.push("Generated by UDN Navigator (demonstration). Non-diagnostic; requires clinician review. Synthetic data only.");

    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mdt-minutes-${CASE_SUMMARY.caseId}-${stamp}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  return (
    <section className="card board-room" aria-label="MDT board room" data-testid="mdt-board-room">
      <div className="board-room__head">
        <span className="ai-badge">
          <Icon name="activity" size={13} /> AI-facilitated
        </span>
        <h2 className="card__title">MDT board room</h2>
        <button type="button" className="btn board-room__export" onClick={exportMinutes}>
          <Icon name="file-text" size={15} /> Export minutes
        </button>
      </div>
      <p className="card__subtitle">Motion: {MOTION}</p>

      <div className="board-quorum">
        <span className={`pill ${quorumMet ? "pill--success" : "pill--danger"}`}>
          {quorumMet ? "Quorum met" : "Quorum not met"}
        </span>
        <span className="board-quorum__label">Core members:</span>
        {CORE_ROLES.map((id) => {
          const r = ROLES.find((x) => x.id === id);
          const present = online.has(id);
          return (
            <span key={id} className={`chip ${present ? "chip--present" : "chip--absent"}`}>
              {present ? "✓" : "○"} {r?.label ?? id}
            </span>
          );
        })}
      </div>

      <div className="board-table-wrap">
        <BoardTable seats={seats} backing={backing} total={total} />
      </div>
      <p className="ai-disclaimer board-table-credit">
        Seats use free stock placeholder portraits (randomuser.me) as illustrative stand-ins — not the real care team and not patient data.
      </p>

      <div className="board-room__grid">
        <div className="board-panel">
          <h3 className="cw-subheading">Agenda</h3>
          <ul className="queue-list">
            {AGENDA.map((a, i) => (
              <li key={a.item} className="queue-item">
                <span className={`queue-item__severity queue-item__severity--${a.tone}`} aria-hidden="true" />
                <span className="queue-item__body">
                  <span className="queue-item__primary">{i + 1}. {a.item}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="board-panel">
          <div className="board-panel__head">
            <h3 className="cw-subheading">Your AI pre-read</h3>
            <label className="board-room__role-select">
              <span className="visually-hidden">Preview pre-read for role</span>
              <select value={previewRole} onChange={(e) => setPreviewRole(e.target.value as RoleId)}>
                {ROLES.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </label>
          </div>
          <ul className="key-list">
            {PRE_READS[previewRole].map((b) => (
              <li key={b}>
                <Icon name="check-circle" size={15} className="key-list__icon" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <h3 className="cw-subheading">Board positions &amp; AI consensus</h3>
      <ul className="board-votes">
        {(Object.keys(positions) as RoleId[]).map((id) => {
          const r = ROLES.find((x) => x.id === id);
          const p = positions[id];
          const meta = STANCE_META[p.stance];
          return (
            <li key={id} className="board-vote">
              <span className="board-vote__role">{r?.label ?? id}{id === myRoleId ? " (you)" : ""}</span>
              <span className={`pill pill--${meta.tone}`}>{meta.label}</span>
              <span className="board-vote__rationale">{p.rationale}</span>
            </li>
          );
        })}
      </ul>

      <div className="board-consensus">
        <div className="board-consensus__bar" aria-hidden="true">
          <span className="match-item__bar">
            <span className="match-item__fill match-item__fill--success" style={{ width: `${Math.round((backing / total) * 100)}%` }} />
          </span>
        </div>
        <p className="board-consensus__text" role="status">
          <strong>AI consensus:</strong> {backing} of {total} back the motion ({tally.support} support, {tally.conditional} conditional,
          {" "}{tally.oppose} oppose, {tally.abstain} abstain). Agreement: adopt as the <em>working</em> (not final) diagnosis given
          PVS1 and a classic phenotype. Conditions before finalising and disclosing: confirm de novo status (parental segregation)
          and obtain matching consent. <strong>Key open question:</strong> is the MECP2 variant de novo? Non-diagnostic; for the board to ratify.
        </p>
      </div>

      <div className="ai-actions board-room__voting">
        <span className="board-room__voting-label">Cast your position ({role?.label ?? "reviewer"}):</span>
        {(Object.keys(STANCE_META) as Stance[]).map((s) => (
          <button
            key={s}
            type="button"
            className={myVote === s ? "btn btn--primary" : "btn"}
            aria-pressed={myVote === s}
            onClick={() => setMyVote(s)}
          >
            {STANCE_META[s].label}
          </button>
        ))}
        {myVote && (
          <button type="button" className="btn btn--ghost" onClick={() => setMyVote(null)}>Clear</button>
        )}
      </div>

      <div className="board-ratify">
        <button
          type="button"
          className="btn btn--primary"
          onClick={ratify}
          disabled={!isChair || !quorumMet || ratified}
        >
          <Icon name="check-circle" size={15} /> {ratified ? "Decision ratified" : "Ratify decision"}
        </button>
        <span className="board-ratify__note" role="status">
          {ratified
            ? "Recorded to the MDT decisions log and audit history (this session)."
            : !isChair
              ? "Only the chair (clinical geneticist or case coordinator) can ratify. Switch role to chair."
              : !quorumMet
                ? "Quorum not met — core members must be present to ratify."
                : "Chair may ratify the motion into a recorded decision."}
        </span>
      </div>

      <CollabBoard />

      <div className="board-room__grid">
        <div className="board-panel">
          <h3 className="cw-subheading">Live minutes (ambient scribe)</h3>
          <ol className="board-minutes">
            {minutes.map((m, i) => (
              <li key={`${i}-${m.text}`} className="board-minute">
                <span className="board-minute__time">{m.time}</span>
                <span className="board-minute__text">{m.text}</span>
              </li>
            ))}
          </ol>
          <VoiceNote onSave={addMinute} />
        </div>

        <div className="board-panel">
          <h3 className="cw-subheading">Action items</h3>
          <ul className="plan-list">
            {ACTION_ITEMS.map((a) => {
              const isDone = done[a.action] === true;
              return (
                <li key={a.action} className={`plan-item${isDone ? " plan-item--done" : ""}`}>
                  <span className={`plan-item__marker plan-item__marker--${isDone ? "success" : a.tone}`} aria-hidden="true" />
                  <span className="plan-item__body">
                    <span className="plan-item__item">{a.action}</span>
                    <span className="plan-item__meta">Owner: {a.owner}</span>
                  </span>
                  <button type="button" className="btn btn--ghost" aria-pressed={isDone} onClick={() => toggle(a.action)}>
                    {isDone ? "Reopen" : "Mark done"}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="cw-footnote" role="status" aria-live="polite">{completed} of {ACTION_ITEMS.length} action items complete.</p>
        </div>
      </div>

      <AiTaskPanel
        title="AI facilitator — MDT pre-read &amp; minutes draft"
        task="mdt-summary"
        fallbackText="Summary: paediatric female with a pathogenic MECP2 stop-gained variant consistent with Rett syndrome. Key findings: seizures, developmental regression, acquired microcephaly; variant absent from gnomAD, high de novo confidence on trio QC. Open questions: de novo status unconfirmed; matching consent pending. Proposed actions: parental segregation, obtain consent, schedule disclosure. Non-diagnostic; for clinician review."
      />

      <h3 className="cw-subheading">Virtual specialist (grounded)</h3>
      <AiCopilot />

      <p className="ai-disclaimer">
        Demonstration board room — session-local. AI facilitation is non-diagnostic and human-in-the-loop; a production build
        would run real-time presence on a realtime backend behind authentication and persist minutes to the audit trail.
      </p>
    </section>
  );
}
