import { useState } from "react";
import { COPILOT_ENDPOINT } from "../config.js";
import { recordGenerated, recordDecision, useOversight } from "../ai/oversight.js";
import {
  AI_META,
  generateCaseSummary,
  explainVariant,
  differentialSuggestions,
  nextBestActions,
  answerQuestion,
  SUGGESTED_QUESTIONS
} from "../ai/caseAi.js";

// AI decision-support components. Every panel is clearly labelled AI-assisted,
// non-diagnostic, grounded in structured case data, and human-in-the-loop.

function AiBadge() {
  return (
    <span className="ai-badge" title="AI-assisted (demonstration)">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8z" />
        <path d="M19 14l.9 2.6L22.5 17l-2.6.9L19 20l-.9-2.6L15.5 17l2.6-.9z" />
      </svg>
      AI assist
    </span>
  );
}

function AiDisclaimer({ grounding }: { readonly grounding?: string }) {
  return (
    <p className="ai-disclaimer">
      {AI_META.assistant} · {AI_META.mode}. Non-diagnostic; requires clinician review.
      {grounding ? ` Grounded in: ${grounding}.` : ""}
    </p>
  );
}

interface BedrockResult {
  readonly answer: string;
  readonly guardrail?: string;
}

/** Call the Bedrock-backed endpoint for a grounded task. Returns null on any
 *  failure so callers can keep their deterministic baseline text. */
async function bedrockTask(task: string): Promise<BedrockResult | null> {
  if (!COPILOT_ENDPOINT || typeof fetch !== "function") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(COPILOT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { answer?: string; guardrail?: string };
    return typeof data.answer === "string" && data.answer ? { answer: data.answer, guardrail: data.guardrail } : null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/** Split a model answer into its body and the "Grounded in: …" citation list. */
export function splitGrounding(text: string): { body: string; cites: readonly string[] } {
  const m = /grounded in:\s*/i.exec(text);
  if (!m) return { body: text.trim(), cites: [] };
  const body = text.slice(0, m.index).trim();
  const rest = text.slice(m.index + m[0].length).trim().replace(/\.\s*$/, "");
  const cites = rest.split(/[,;]/).map((c) => c.trim()).filter(Boolean);
  return { body, cites };
}

/** Small row of citation chips + guardrail status for a generated answer. */
function AiProvenance({ cites, guardrail, generated }: { readonly cites: readonly string[]; readonly guardrail?: string; readonly generated: boolean }) {
  if (!generated) return null;
  return (
    <div className="ai-provenance">
      {guardrail && guardrail !== "off" && (
        <span className={`pill ${guardrail === "intervened" ? "pill--danger" : "pill--success"}`}>
          Guardrail: {guardrail}
        </span>
      )}
      {cites.length > 0 ? (
        <>
          <span className="ai-provenance__label">Grounded in:</span>
          {cites.map((c) => (
            <span key={c} className="chip">{c}</span>
          ))}
        </>
      ) : (
        <span className="pill pill--warning">citation missing — verify grounding</span>
      )}
    </div>
  );
}

/** Shows a deterministic baseline text with a "Generate with Bedrock" action
 *  that replaces it with a live model response (falling back on failure). */
function BedrockText({ task, fallbackText }: { readonly task: string; readonly fallbackText: string }) {
  const [text, setText] = useState(fallbackText);
  const [cites, setCites] = useState<readonly string[]>([]);
  const [guardrail, setGuardrail] = useState<string | undefined>(undefined);
  const [source, setSource] = useState<"baseline" | "bedrock" | "failed">("baseline");
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (loading) return;
    setLoading(true);
    const result = await bedrockTask(task);
    setLoading(false);
    if (result) {
      const { body, cites: c } = splitGrounding(result.answer);
      setText(body);
      setCites(c);
      setGuardrail(result.guardrail);
      setSource("bedrock");
      recordGenerated(result.guardrail);
    } else {
      setSource("failed");
    }
  };

  return (
    <>
      <p className="ai-panel__body" role="status" aria-live="polite">{text}</p>
      <AiProvenance cites={cites} guardrail={guardrail} generated={source === "bedrock"} />
      <div className="ai-actions">
        <button type="button" className="btn" onClick={() => void generate()} disabled={loading}>
          {loading ? "Generating…" : source === "bedrock" ? "Regenerate with Bedrock" : "Generate with Bedrock"}
        </button>
        <span className="ai-copilot__grounding">
          {source === "bedrock"
            ? "Source: Amazon Bedrock (Nova Lite) + Guardrail"
            : source === "failed"
              ? "Bedrock unavailable — showing on-device baseline"
              : "Source: on-device baseline"}
        </span>
      </div>
    </>
  );
}

/** Session-local AI oversight tally (human-in-the-loop governance signal). */
export function AiOversightPanel() {
  const o = useOversight();
  return (
    <section className="ai-panel ai-panel--oversight" aria-label="AI oversight" data-testid="ai-oversight">
      <div className="ai-panel__head">
        <AiBadge />
        <h2 className="ai-panel__title">AI oversight (this session)</h2>
      </div>
      <ul className="oversight-grid">
        <li className="oversight-stat"><span className="oversight-stat__n">{o.generated}</span><span className="oversight-stat__l">AI outputs generated</span></li>
        <li className="oversight-stat"><span className="oversight-stat__n">{o.accepted}</span><span className="oversight-stat__l">Accepted by clinician</span></li>
        <li className="oversight-stat"><span className="oversight-stat__n">{o.flagged}</span><span className="oversight-stat__l">Flagged for revision</span></li>
        <li className="oversight-stat"><span className="oversight-stat__n">{o.dismissed}</span><span className="oversight-stat__l">Dismissed</span></li>
        <li className="oversight-stat"><span className="oversight-stat__n">{o.guardrailPassed}</span><span className="oversight-stat__l">Guardrail passed</span></li>
        <li className="oversight-stat"><span className="oversight-stat__n">{o.guardrailIntervened}</span><span className="oversight-stat__l">Guardrail interventions</span></li>
      </ul>
      <p className="ai-disclaimer">Session-local demonstration log; a production build records these to the immutable audit trail as AI-suggested vs clinician-confirmed.</p>
    </section>
  );
}

/** AI case summary with clinician accept/flag (human-in-the-loop). */
export function AiCaseSummary() {
  const summary = generateCaseSummary();
  const [decision, setDecision] = useState<"pending" | "accepted" | "flagged">("pending");

  return (
    <section className="ai-panel" aria-label="AI case summary" data-testid="ai-case-summary">
      <div className="ai-panel__head">
        <AiBadge />
        <h2 className="ai-panel__title">AI-assisted synopsis</h2>
        {decision === "accepted" && <span className="pill pill--success">Confirmed by clinician</span>}
        {decision === "flagged" && <span className="pill pill--warning">Flagged for revision</span>}
      </div>
      <BedrockText task="summary" fallbackText={summary.text} />
      <div className="ai-grounding">
        {summary.grounding.map((g) => (
          <span key={g.label} className="chip">{g.label}</span>
        ))}
      </div>
      <div className="ai-actions">
        <button type="button" className="btn btn--primary" onClick={() => { setDecision("accepted"); recordDecision("accepted"); }}>Accept</button>
        <button type="button" className="btn" onClick={() => { setDecision("flagged"); recordDecision("flagged"); }}>Flag for revision</button>
        {decision !== "pending" && (
          <button type="button" className="btn btn--ghost" onClick={() => setDecision("pending")}>Reset</button>
        )}
      </div>
      <AiDisclaimer />
    </section>
  );
}

interface CopilotResult {
  readonly answer: string;
  readonly source: string;
}

/** Grounded case Q&A copilot: calls Amazon Bedrock live, falls back to the
 *  on-device deterministic synthesizer if the endpoint is unreachable. */
export function AiCopilot() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<CopilotResult | null>(null);
  const [loading, setLoading] = useState(false);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || loading) return;
    setQuery(question);
    setResult(null);

    // Try the live Bedrock endpoint; fall back to deterministic on any failure.
    if (COPILOT_ENDPOINT && typeof fetch === "function") {
      setLoading(true);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(COPILOT_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
          signal: controller.signal
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { answer?: string; guardrail?: string };
        if (data.answer) {
          const guard = data.guardrail && data.guardrail !== "off" ? ` · guardrail: ${data.guardrail}` : "";
          setResult({ answer: data.answer, source: `Amazon Bedrock (Nova Lite) · live${guard}` });
          recordGenerated(data.guardrail);
          setLoading(false);
          return;
        }
        throw new Error("empty answer");
      } catch {
        clearTimeout(timer);
        // fall through to deterministic
      }
      setLoading(false);
    }

    const local = answerQuestion(question);
    setResult({
      answer: local.answer,
      source: local.grounding === "n/a" ? "on-device synthesizer" : `on-device synthesizer · grounded in ${local.grounding}`
    });
  };

  return (
    <section className="ai-panel" aria-label="Case copilot" data-testid="ai-copilot">
      <div className="ai-panel__head">
        <AiBadge />
        <h2 className="ai-panel__title">Ask about this case</h2>
      </div>
      <div className="ai-copilot__chips">
        {SUGGESTED_QUESTIONS.map((q) => (
          <button key={q} type="button" className="chip chip--action" onClick={() => void ask(q)}>{q}</button>
        ))}
      </div>
      <form
        className="ai-copilot__form"
        onSubmit={(e) => { e.preventDefault(); void ask(query); }}
      >
        <label htmlFor="ai-copilot-input" className="visually-hidden">Ask a question about this case</label>
        <input
          id="ai-copilot-input"
          className="ai-copilot__input"
          type="text"
          value={query}
          placeholder="Ask about the diagnosis, variant, phenotypes…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={loading}>{loading ? "Asking…" : "Ask"}</button>
      </form>
      {loading && <p className="ai-copilot__grounding" role="status">Consulting the model…</p>}
      {result && (
        <div className="ai-copilot__answer" role="status" aria-live="polite">
          <p className="ai-copilot__answer-text">{result.answer}</p>
          <p className="ai-copilot__grounding">Source: {result.source}</p>
        </div>
      )}
      <p className="ai-disclaimer">
        {AI_META.assistant} answers about this synthetic case only, via Amazon Bedrock when reachable
        (on-device fallback otherwise). Non-diagnostic; requires clinician review.
      </p>
    </section>
  );
}

/** Generic Bedrock-backed AI panel: a titled card with an on-device baseline
 *  and a "Generate with Bedrock" action for a given grounded task. */
export function AiTaskPanel({
  title,
  task,
  fallbackText,
  inline
}: {
  readonly title: string;
  readonly task: string;
  readonly fallbackText: string;
  readonly inline?: boolean;
}) {
  return (
    <div className={inline ? "ai-panel ai-panel--inline" : "ai-panel"} aria-label={title} data-testid={`ai-task-${task}`}>
      <div className="ai-panel__head">
        <AiBadge />
        <h3 className="ai-panel__title">{title}</h3>
      </div>
      <BedrockText task={task} fallbackText={fallbackText} />
      <AiDisclaimer />
    </div>
  );
}

/** AI plain-language variant interpretation (grounded in ACMG evidence). */
export function AiVariantExplanation() {
  const { text, grounding } = explainVariant();
  return (
    <div className="ai-panel ai-panel--inline" aria-label="AI variant interpretation" data-testid="ai-variant-explanation">
      <div className="ai-panel__head">
        <AiBadge />
        <h3 className="ai-panel__title">Interpretation assistant</h3>
      </div>
      <BedrockText task="variant" fallbackText={text} />
      <AiDisclaimer grounding={grounding.map((g) => g.label).join(", ")} />
    </div>
  );
}

/** AI differential + next-best-action suggestions with accept/dismiss. */
export function AiDifferentialSuggestions() {
  const suggestions = differentialSuggestions();
  const actions = nextBestActions();
  const [states, setStates] = useState<Readonly<Record<string, "open" | "accepted" | "dismissed">>>({});

  const set = (key: string, value: "open" | "accepted" | "dismissed") =>
    setStates((prev) => ({ ...prev, [key]: value }));

  return (
    <section className="ai-panel" aria-label="AI suggestions" data-testid="ai-differential">
      <div className="ai-panel__head">
        <AiBadge />
        <h3 className="ai-panel__title">Suggested differentials &amp; next steps</h3>
      </div>

      <ul className="ai-suggestions">
        {suggestions.map((s) => {
          const st = states[s.title] ?? "open";
          return (
            <li key={s.title} className={`ai-suggestion ai-suggestion--${st}`}>
              <div className="ai-suggestion__head">
                <span className="ai-suggestion__title">{s.title}</span>
                <span className={`pill pill--${s.tone}`}>{s.confidence}% confidence</span>
              </div>
              <div className="match-item__bar" aria-hidden="true">
                <span className={`match-item__fill match-item__fill--${s.tone}`} style={{ width: `${s.confidence}%` }} />
              </div>
              <p className="ai-suggestion__rationale">{s.rationale}</p>
              {st === "open" ? (
                <div className="ai-actions">
                  <button type="button" className="btn btn--primary" onClick={() => { set(s.title, "accepted"); recordDecision("accepted"); }}>Accept into hypotheses</button>
                  <button type="button" className="btn btn--ghost" onClick={() => { set(s.title, "dismissed"); recordDecision("dismissed"); }}>Dismiss</button>
                </div>
              ) : (
                <div className="ai-actions">
                  <span className={`pill pill--${st === "accepted" ? "success" : "neutral"}`}>
                    {st === "accepted" ? "Accepted" : "Dismissed"}
                  </span>
                  <button type="button" className="btn btn--ghost" onClick={() => set(s.title, "open")}>Undo</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <h4 className="cw-subheading">AI assessment</h4>
      <BedrockText
        task="differential"
        fallbackText="Top match is Rett syndrome (MECP2); CDKL5 and FOXG1 are the principal differentials. Confirming the MECP2 variant's de novo status and reviewing seizure onset/microcephaly specifics would best discriminate them. Non-diagnostic."
      />

      <h4 className="cw-subheading">Recommended next actions</h4>
      <ul className="plan-list">
        {actions.map((a) => (
          <li key={a.action} className="plan-item">
            <span className={`plan-item__marker plan-item__marker--${a.tone}`} aria-hidden="true" />
            <span className="plan-item__body">
              <span className="plan-item__item">{a.action}</span>
              <span className="plan-item__meta">{a.rationale}</span>
            </span>
          </li>
        ))}
      </ul>

      <AiDisclaimer grounding="phenotype match + evidence gaps" />
    </section>
  );
}
