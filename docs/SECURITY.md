# Security Model

The Navigator follows AWS Well-Architected security principles: least
privilege, encryption everywhere, immutable audit, and defence in depth. This
document describes authentication and authorisation, data protection, the
AI_Gateway's injection defences, and audit.

## Authentication and session management

Authentication uses an **Amazon Cognito user pool** with one group per role. A
**Lambda authorizer** validates the Cognito JWT on every API call, enforces the
**15-minute inactivity session timeout**, and injects the caller's role and
identity into the request context for downstream role checks and audit. Valid
credentials are required before any access to case data is granted.

## Role-based access control (RBAC)

The Navigator supports seven roles: Clinical geneticist, Bioinformatician,
Genetic counsellor, Medical specialist, Researcher, Case coordinator, and
Administrator. Every create/read/update/delete on case data is checked against
the role matrix.

- Unauthorised operations are **denied**, leave target data unchanged, return a
  not-authorised indication, and emit an audit event with actor, attempted
  operation, and timestamp.
- Reads return only the records the role is authorised to access; all others
  are excluded.

### RBAC matrix (summary)

C=create, R=read, U=update, D=delete; blank = denied.

| Capability | Clin. gen. | Bioinf. | Gen. couns. | Med. spec. | Researcher | Case coord. | Admin |
|---|---|---|---|---|---|---|---|
| View case / timeline | R | R | R | R | R | R | R |
| Intake / create case | | | | | | C | C |
| Request phenotype extraction | C | | C | C | | | |
| Approve/reject/edit phenotype | CRU | | | CRU | | | U |
| Resolve contradiction | RU | RU | RU | RU | | | U |
| Configure gap rules | | | | | | | CU |
| Create analysis request | | C | | | | C | |
| Approve analysis run | | U | | U | | | U |
| Run deterministic prioritisation | R | CR | | R | R | | |
| Create/update hypothesis card | CRU | RU | RU | CRU | R | | U |
| MDT comment/vote/decision/task | CRU | CRU | CRU | CRU | R | CRU | U |
| Record disposition / approve summary | CRU | | RU | CRU | | CRU | U |
| Create knowledge snapshot/update | | | | | C | | CU |
| Approve reanalysis run | CRU | RU | RU | CRU | | | U |
| View audit viewer | R | R | R | R | R | R | R |
| Manage users/roles/config | | | | | | | CRUD |
| Access Ground_Truth | denied | denied | denied | denied | denied | denied | denied |

**Ground_Truth is accessible to no interactive role.** Only the offline
Evaluation_Framework identity can read it.

## Data protection

- **Encryption at rest.** Case data is stored in encrypted form. Every S3
  bucket has server-side encryption (SSE-KMS with customer-managed keys)
  enabled; DynamoDB is encrypted at rest.
- **Encryption in transit.** Case data is transmitted over encrypted transport
  only; connections attempted over an unencrypted channel are rejected.
- **S3 object versioning** is enabled on every artifact bucket.
- **Per-type prefixes.** Each artifact type is stored under a separate,
  dedicated S3 prefix (e.g. `fhir/`, `phenopacket/`, `vcf/`, `annotation/`,
  `qc/`, `candidates/`, `precomputed/`).
- **Ground_Truth isolation.** Ground_Truth lives in a **separate bucket** whose
  bucket policy and IAM grants permit only the Evaluation_Framework role and
  deny all others with an authorization error.

## Least privilege

Each service component is granted only the IAM permissions required to perform
its function; all other actions are denied by default. This applies to Lambda
execution roles, Step Functions roles, and the Evaluation_Framework identity.

## Secrets management

When a component requires a secret at runtime it is retrieved from **AWS
Secrets Manager**. Secret values are never persisted in application code, logs,
or on-disk files.

## AI_Gateway security

The `AI_Gateway` is the sole path to Amazon Bedrock; any generative invocation
that does not route through it is rejected. Its security controls:

- **Untrusted content isolation.** All case-document content is treated as
  untrusted data, never as instructions. Invocations place system instructions
  and untrusted document content in separate, delimited segments; document
  content is presented only as data.
- **Allowlist output validation.** Model output is validated against an
  allowlist of permitted response structures before it is persisted. Output
  failing validation is rejected, not persisted, the prior state is retained,
  and the failure is logged in the invocation log.
- **Authorised context only.** The context supplied to the model is restricted
  to the case data the invoking user is authorised to access; unauthorised
  portions are excluded and the exclusion is logged.
- **Invocation log.** Every invocation writes a log entry with model id,
  invoking user id, timestamp, and validation outcome.

## Audit and monitoring

- The `Audit_Service` records an audit event within 5 seconds of any
  create/modify/approve/reject/delete on case data, capturing actor identity,
  action, affected object id, and a UTC timestamp with at least second
  precision.
- Audit events are **immutable** with a minimum **7-year retention**;
  modification/deletion requests are rejected. Recording failures retry up to 3
  times, then return an error and preserve the pending event for reprocessing.
- **CloudTrail** independently records management and data-access events with a
  minimum **365-day retention**.
- **CloudWatch** collects logs and metrics; **WAF** protects CloudFront and API
  Gateway at the edge.

## Edge protection

CloudFront fronts the static web application with a WAF web ACL; API Gateway is
similarly protected. TLS is enforced end to end.
