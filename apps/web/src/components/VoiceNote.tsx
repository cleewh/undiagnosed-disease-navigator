import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons.js";

// Voice-to-text clinical note composer. Uses the browser's built-in Web Speech
// API (SpeechRecognition) for live dictation — no backend, no cost, works in
// Chromium-based browsers. Falls back to plain typing where the API is
// unavailable (e.g. some browsers, or a test/jsdom environment). A production
// build would swap this for Amazon Transcribe Medical (medical-domain ASR with
// speaker separation) behind an authenticated streaming endpoint.

// Minimal typing for the non-standard SpeechRecognition browser API.
interface SpeechRecognitionResult {
  readonly transcript: string;
  readonly isFinal: boolean;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<SpeechRecognitionResult>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceNote({ onSave }: { readonly onSave?: (text: string) => void }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [saved, setSaved] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const baseText = useRef("");

  const Ctor = getRecognitionCtor();
  const supported = Ctor !== null;

  useEffect(() => {
    return () => {
      if (recognition.current) {
        recognition.current.onresult = null;
        recognition.current.onerror = null;
        recognition.current.onend = null;
        recognition.current.stop();
      }
    };
  }, []);

  const start = () => {
    if (!Ctor || listening) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    baseText.current = text ? `${text} ` : "";
    rec.onresult = (event) => {
      let combined = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const alt = event.results[i]?.[0];
        if (alt) combined += alt.transcript;
      }
      setText(`${baseText.current}${combined}`.trimStart());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognition.current = rec;
    rec.start();
    setListening(true);
    setSaved(false);
  };

  const stop = () => {
    if (recognition.current) recognition.current.stop();
    setListening(false);
  };

  const save = () => {
    const body = text.trim();
    if (!body) return;
    onSave?.(body);
    setText("");
    setSaved(true);
  };

  return (
    <div className="voicenote" data-testid="voice-note">
      <div className="voicenote__head">
        <h3 className="cw-subheading">Dictate a clinical note</h3>
        {supported ? (
          <span className={`pill ${listening ? "pill--danger" : "pill--neutral"}`}>
            {listening ? "Listening…" : "Voice ready"}
          </span>
        ) : (
          <span className="pill pill--neutral">Type only (voice unsupported)</span>
        )}
      </div>

      <textarea
        className="voicenote__area"
        rows={3}
        value={text}
        placeholder={supported ? "Press Dictate and speak, or type here…" : "Type your note here…"}
        aria-label="Clinical note text"
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
      />

      <div className="ai-actions">
        {supported &&
          (listening ? (
            <button type="button" className="btn btn--danger" onClick={stop}>
              <Icon name="activity" size={16} /> Stop
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={start}>
              <Icon name="activity" size={16} /> Dictate
            </button>
          ))}
        <button type="button" className="btn" onClick={save} disabled={!text.trim()}>
          Save note
        </button>
        {saved && <span className="pill pill--success">Note added</span>}
      </div>

      <p className="ai-disclaimer">
        {supported
          ? "In-browser speech recognition (Web Speech API); nothing is sent to a server. Production would use Amazon Transcribe Medical."
          : "This browser has no speech recognition; a production build would stream to Amazon Transcribe Medical."}
        {" "}Synthetic case — non-diagnostic.
      </p>
    </div>
  );
}
