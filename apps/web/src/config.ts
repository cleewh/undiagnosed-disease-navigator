// Runtime configuration for the web app.
//
// COPILOT_ENDPOINT is the AI copilot backend: an Amazon API Gateway HTTP API
// (CORS-locked to this site's origin, throttled) that invokes a Lambda calling
// Amazon Bedrock (Nova Lite) with a Bedrock Guardrail applied. The Lambda has no
// public Function URL — reachable only via API Gateway. It supports grounded
// tasks (summary, variant, differential, mdt-summary, report-letter, next-test,
// acmg) and free-text Q&A. If the call fails, panels fall back to the on-device
// deterministic baseline.
export const COPILOT_ENDPOINT = "https://zoel6aurb4.execute-api.us-east-1.amazonaws.com/copilot";
