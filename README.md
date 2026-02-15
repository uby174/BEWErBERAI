# BewerberAI Job Application Optimizer

BewerberAI is a Vite + React + TypeScript application that optimizes resumes and cover letters against a target Job Description (JD) with a structured, auditable AI pipeline.

It is designed around deterministic guardrails:
- strict JSON schemas between stages
- no fabricated achievements/metrics
- optional PII redaction before model calls
- deterministic ATS coverage and retrieval traces
- eval and CI gates for regression control

## Core Capabilities

- 3-stage analysis pipeline:
1. `extractFacts()`
2. `scoreMatch()`
3. `rewriteDocs()`
- Tier routing by complexity:
1. `Fast` -> `SIMPLE`
2. `Balanced` -> `MEDIUM`
3. `Deep` -> `COMPLEX`
- Deterministic ATS coverage:
1. hard requirements
2. soft requirements
3. tools/tech keyword matching (`matched`, `missing`, `partial`)
- Metrics vault enforcement:
1. rewritten output may only use numeric values present in `metricsVault`
2. unauthorized numbers trigger correction/retry
- Privacy mode:
1. redacts email/phone/address/birth date/personal IDs before model input
2. keeps city/country and role history intact
3. restores only original user-provided PII placeholders in output
- Google Docs/Drive integration:
1. upload/convert DOCX
2. preview and export optimized docs
3. Docs writeback service utilities are available in `services/googleDocsService.ts`
- Technical traceability in `AnalysisResult.analysisTrace`:
1. `inputHash`
2. `retrievalChunkIds`
3. `retrievalTrace` (chunk id + reason)
4. model/tier/timestamp/retry count

## Architecture

Frontend:
- `App.tsx`: input flow, file ingestion, analysis mode, privacy mode, metrics vault
- `components/ResultsDashboard.tsx`: tabbed output (`Must-fix`, `ATS Coverage`, `Rewrite Preview`)

AI + domain services:
- `services/geminiService.ts`: orchestration, retries, tier routing, schema enforcement
- `services/atsCoverageService.ts`: deterministic JD parsing and coverage scoring
- `services/retrievalService.ts`: chunking + retrieval selection + trace reasons
- `services/privacyService.ts`: PII redaction/restore and validation
- `services/metricsGuardService.ts`: numeric-token authorization against vault
- `services/analysisSchemaService.ts`: runtime `AnalysisResult` schema validation

Document services:
- `services/documentService.ts`: DOCX text extraction
- `services/googleDriveService.ts`: OAuth + upload/export
- `services/googleDocsService.ts`: create + batchUpdate helpers for docs writeback

Quality gates:
- Unit tests: `tests/`
- Golden fixtures: `tests/golden/`
- End-to-end evals: `evals/`
- Audit script: `scripts/audit.mjs`

## Tech Stack

- React 19
- TypeScript 5
- Vite 6
- Vitest + Testing Library
- Google Gemini SDK (`@google/genai`)
- Recharts
- Mammoth (DOCX extraction)

## Repository Structure

```txt
.
├── App.tsx
├── components/
├── services/
├── tests/
│   ├── golden/
│   └── __snapshots__/
├── evals/
│   ├── fixtures/
│   ├── assertions.ts
│   ├── runner.ts
│   └── report.ts
├── scripts/
│   └── audit.mjs
├── vite.config.ts
├── vitest.config.ts
└── package.json
```

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+

### Install

```bash
npm install
```

### Environment

Create `.env.local` in project root:

```env
VITE_GEMINI_API_KEY=your_actual_gemini_api_key
VITE_GOOGLE_CLIENT_ID=your_google_oauth_client_id
```

Important:
- do not use `process.env.*` in browser runtime code
- use `import.meta.env.VITE_*` for client-side variables

### Run

```bash
npm run dev
```

## Scripts

- `npm run dev` -> start dev server
- `npm run build` -> production build
- `npm run preview` -> preview build output
- `npm run typecheck` -> TypeScript checks (`tsc --noEmit`)
- `npm run test:run` -> unit tests
- `npm run evals:run` -> fixture-based end-to-end evals
- `npm run ci` -> `typecheck + tests + evals + build`

## Pipeline Details

`analyzeApplication()` runs a strict pipeline:

1. `extractFacts()`
- extracts only facts from resume/cover/JD
- returns nulls for missing/uncertain data
- no rewriting

2. `scoreMatch()`
- computes ATS and gap analysis from extracted facts
- evidence required for each improvement
- snippets are capped to 20 words

3. `rewriteDocs()`
- rewrites using only extracted facts + explicit user achievements
- enforces metrics vault constraints
- enforces privacy placeholder constraints
- retries with correction prompt if output violates guards

All stage outputs are normalized and validated before final assembly.

## Model Routing

Tier selection is controlled by `selectTier(input)`:
- `SIMPLE` for short inputs / fast mode
- `MEDIUM` for standard analysis
- `COMPLEX` for long docs, deep mode, or deep-analysis intent

Each tier uses dedicated model + token budgets while keeping output schema identical.

## Privacy and Security

PII redaction layer (`services/privacyService.ts`):
- redacts: email, phone, street address, full birth date, personal IDs
- preserves: city/country, role history, non-PII context
- restores only known placeholders from original input

Security posture:
- least-privilege OAuth scope in Drive integration (`drive.file`)
- no API key logging
- runtime guard for missing Gemini API key
- outbound validation against unauthorized PII leakage

## Deterministic ATS and Evidence

ATS module parses JD into:
- hard requirements
- soft requirements
- tools/tech keywords

Coverage output:
- `keywordCoverage.matched`
- `keywordCoverage.missing`
- `keywordCoverage.partial`
- `hardRequirementsMissing`

Each improvement requires evidence:
- `resumeQuotes`
- `jdQuotes`
- `missingKeywords`

## Testing Strategy

Unit tests include:
- retrieval determinism
- privacy redaction behavior
- schema validation
- metrics vault unauthorized-number detection
- dashboard behavior

Golden tests (`tests/golden/`):
- deterministic structured-output snapshots

## End-to-End Evals

Run:

```bash
npm run evals:run
```

Evals execute all fixtures across `fast`, `balanced`, `deep` tiers and validate strict assertions:

1. schema validation
2. evidence snippet length <= 20 words
3. empty metrics vault -> no unauthorized numeric claims
4. output companies/dates must exist in resume input
5. hard requirement gaps populated when JD demands
6. privacy-mode outbound payload is redacted before model call
7. retrieval trace includes chunk ids and reasons

Report output:
- `evals/report.json`

### Real API eval mode (manual verification)

Default eval mode is mock (no external model calls).

To run with real Gemini API:

```bash
set EVALS_REAL_API=true
set VITE_GEMINI_API_KEY=your_actual_gemini_api_key
npm run evals:run
```

## Audit

Run:

```bash
node scripts/audit.mjs
```

This verifies required guardrails and project structure (env handling, pipeline functions, retrieval, privacy, tests, golden fixtures, Docs writeback service).

## Operational Guidance

Recommended CI gate:

```bash
npm run ci
```

Recommended branch policy:
- require passing `ci`
- require review on `services/geminiService.ts`, `services/privacyService.ts`, `services/metricsGuardService.ts`
- block direct pushes to main

## Troubleshooting

- `Missing Gemini API key`:
1. confirm `.env.local` has `VITE_GEMINI_API_KEY`
2. restart dev server

- Google OAuth/connectivity issues:
1. confirm client ID setup in `services/googleDriveService.ts`
2. verify browser popups and consent

- Evals failing:
1. inspect `evals/report.json`
2. check failed assertion names/details per fixture and tier

## GitHub Publication Notes

This local folder may not yet be a Git repository. To publish to GitHub:

```bash
git init
git add .
git commit -m "Initial commit: BewerberAI"
git branch -M main
git remote add origin https://github.com/<your-org>/<your-repo>.git
git push -u origin main
```

If you already have a remote repository URL, replace `<your-org>/<your-repo>` accordingly.
# BewerberAI
