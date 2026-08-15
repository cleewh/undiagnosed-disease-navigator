"use strict";

// UDN Copilot Lambda: a grounded, non-diagnostic clinical decision-support
// assistant for the SYNTHETIC demonstration case. Calls Amazon Bedrock
// (Converse) with a fixed system prompt and the case context embedded here
// server-side, so the endpoint can only answer about this demo case. An
// optional Bedrock Guardrail is applied when configured. All output is
// explicitly non-diagnostic and for clinician review. No real patient data.

const { BedrockRuntimeClient, ConverseCommand } = require("@aws-sdk/client-bedrock-runtime");

const client = new BedrockRuntimeClient({});
const MODEL_ID = process.env.MODEL_ID || "anthropic.claude-3-haiku-20240307-v1:0";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const GUARDRAIL_ID = process.env.GUARDRAIL_ID || "";
const GUARDRAIL_VERSION = process.env.GUARDRAIL_VERSION || "";
const MAX_QUESTION_CHARS = 500;

const CASE_CONTEXT = [
  "Case: UDN-SYN-0007 (synthetic demonstration patient; no real patient data).",
  "Proband: paediatric, onset in infancy. Area: neurodevelopmental.",
  "Phenotypes (HPO): Seizure (HP:0001250), Developmental regression (HP:0002376),",
  "Global developmental delay (HP:0001263), Microcephaly (HP:0000252), Stereotypy (HP:0000733).",
  "Genomics: trio exome. Candidate variant MECP2 NM_004992.3:c.502C>T (p.Arg168*), rs61748421,",
  "a stop-gained (loss-of-function) variant. ClinVar: Pathogenic. CADD 36. Absent from gnomAD.",
  "ACMG/AMP criteria applied: PVS1 (very strong), PM6 (assumed de novo, unconfirmed), PM2 (absent) => Pathogenic.",
  "Working diagnosis: Rett syndrome (OMIM 312750; ORPHA:778; MONDO:0010726; ICD-10 F84.2). X-linked, usually de novo.",
  "Differential genes: CDKL5 (developmental & epileptic encephalopathy), FOXG1 (congenital Rett variant).",
  "Therapeutics (informational only): trofinetide (DAYBUE), FDA-approved 2023 for Rett; TSHA-102 gene therapy in trials (NCT05606614).",
  "Outstanding: parental segregation of the MECP2 variant is unconfirmed; external-matching consent is pending.",
  "Investigations: EEG multifocal epileptiform discharges; brain MRI no structural abnormality; mild lactate elevation.",
  "Care team: lead clinical geneticist Dr. Ada Okonkwo; genetic counsellor Ms. Lena Farah; coordinator Mr. Diego Alvarez."
].join("\n");

const SYSTEM_PROMPT = [
  "You are UDN Copilot, a clinical decision-support assistant for a multidisciplinary team reviewing a SYNTHETIC demonstration case.",
  "Rules:",
  "1. Use ONLY the provided CASE CONTEXT. If it cannot be answered from the context, say so briefly.",
  "2. If the request is unrelated to this case, decline and redirect to the case.",
  "3. NEVER provide a medical diagnosis, prognosis, or treatment/medication recommendation. Frame everything as non-diagnostic decision support that requires review by a qualified clinician.",
  "4. Do not invent facts, identifiers, or values not present in the context.",
  "5. This is synthetic demonstration data; never imply it concerns a real patient.",
  "6. End every response with a final line exactly of the form: 'Grounded in: <comma-separated case elements you used>'."
].join("\n");

// Grounded task prompts. Free-text questions use the "qa" task.
const TASK_PROMPTS = {
  summary:
    "Write a concise (<=110 words) multidisciplinary-team case synopsis: presentation, key genomic finding and classification, working diagnosis, and outstanding actions. Non-diagnostic.",
  variant:
    "In plain language (<=110 words), explain the MECP2 variant and its ACMG/AMP classification, and what the evidence means for the team. Explanation of existing evidence, not a diagnosis.",
  differential:
    "Give a brief (<=110 words) assessment of the differential diagnoses and what evidence would best discriminate between them. Non-diagnostic.",
  "mdt-summary":
    "Produce a structured MDT pre-read (<=170 words) with these headings: Summary; Key findings; Open questions; Proposed actions. Non-diagnostic; for clinician review.",
  "report-letter":
    "Draft a family-facing summary letter (<=200 words) in warm, plain, NON-DIAGNOSTIC language: what has been looked at, that a candidate genetic finding is under review (not confirmed), next steps, and that the team will discuss results. Do not state a definitive diagnosis or give treatment advice. Address it generically ('Dear family').",
  "next-test":
    "Recommend the highest-yield next investigations to close the current evidence gaps (<=130 words). For each, give a one-line rationale tied to the case. Frame as suggestions for the MDT to consider, not orders. Non-diagnostic.",
  acmg:
    "List the ACMG/AMP criteria that plausibly apply to the MECP2 variant, each with a one-line justification from the context, and the resulting classification (<=140 words). Note this is a suggestion for clinician confirmation, not an automated call."
};

const TASK_MAX_TOKENS = {
  "mdt-summary": 520,
  "report-letter": 620,
  "next-test": 460,
  acmg: 460
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Content-Type": "application/json"
  };
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  const method =
    (event && event.requestContext && event.requestContext.http && event.requestContext.http.method) || "POST";

  if (method === "OPTIONS") return { statusCode: 204, headers, body: "" };

  try {
    const parsed = event && event.body ? JSON.parse(event.body) : {};
    const task = typeof parsed.task === "string" ? parsed.task : "qa";

    let userText;
    if (task === "qa") {
      let question = typeof parsed.question === "string" ? parsed.question.trim() : "";
      if (!question) return { statusCode: 400, headers, body: JSON.stringify({ error: "A 'question' is required." }) };
      if (question.length > MAX_QUESTION_CHARS) question = question.slice(0, MAX_QUESTION_CHARS);
      userText = question;
    } else if (Object.prototype.hasOwnProperty.call(TASK_PROMPTS, task)) {
      userText = TASK_PROMPTS[task];
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown task." }) };
    }

    const request = {
      modelId: MODEL_ID,
      system: [{ text: `${SYSTEM_PROMPT}\n\nCASE CONTEXT:\n${CASE_CONTEXT}` }],
      messages: [{ role: "user", content: [{ text: userText }] }],
      inferenceConfig: { maxTokens: TASK_MAX_TOKENS[task] || 320, temperature: 0.2, topP: 0.9 }
    };
    if (GUARDRAIL_ID && GUARDRAIL_VERSION) {
      request.guardrailConfig = { guardrailIdentifier: GUARDRAIL_ID, guardrailVersion: GUARDRAIL_VERSION };
    }

    const response = await client.send(new ConverseCommand(request));

    const content = (response.output && response.output.message && response.output.message.content) || [];
    const answer = content.map((c) => c && c.text).filter(Boolean).join("\n").trim() || "No answer produced.";
    const guarded = response.stopReason === "guardrail_intervened";

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ answer, model: MODEL_ID, task, guardrail: GUARDRAIL_ID ? (guarded ? "intervened" : "passed") : "off" })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "copilot_error", message: String((err && err.message) || err) })
    };
  }
};
