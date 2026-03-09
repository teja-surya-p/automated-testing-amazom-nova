# Self-Healing Multi-Agent QA Orchestrator

Node/JavaScript implementation of an intent-based QA system with:

- a Node backend that runs the test state machine and Playwright browser loop
- a React dashboard that streams screenshots and agent reasoning in real time

## What is implemented

- `Explorer` agent with two modes:
  - `heuristic` mode that works immediately and proves the orchestration loop
  - `bedrock` mode that uses the Strands TypeScript SDK plus Amazon Bedrock multimodal prompts
- `Auditor` agent with popup detection, repeated-action detection, and infinite-loader hang detection
- `Documentarian` that turns the last screenshot buffer into a local MP4 and exposes it at `/artifacts/...`
- live event streaming over Server-Sent Events for the dashboard
- session history tracking so the last three actions can be fed back into planning

## Workspace layout

- `backend`: Express API, Playwright runner, agent orchestration, evidence generation
- `frontend`: real-time React operations console

## Code layout: `src/types` + `src/library`

- Type-specific logic lives in `backend/src/types/<type>/` (`foundation`, `uiux`, `functional`, `accessibility`, plus placeholders for the remaining test types).
- Cross-type shared modules live in `backend/src/library/` (schemas, policies, URL helpers, reporting, metrics).
- See `docs/TYPE_MAP.md` for exact folder responsibilities and add-new-rule steps.

## Tests

- Server tests run from both legacy and type-local locations via:
  - `npm test --workspace @qa/server`
- The server test command uses Node test globs:
  - `test/**/*.test.js`
  - `src/types/**/tests/**/*.test.js`

## Artifacts

- Runtime artifacts must never be written under `backend/src`.
- Use `backend/artifacts` (configured by `ARTIFACTS_DIR`).
- If artifacts appear under `backend/src/artifacts`, run `npm run clean` and remove that misplaced folder.

## Run it

1. Install dependencies:

```bash
npm install
```

2. Install the Playwright browser once:

```bash
npx playwright install chromium
```

3. Copy `.env.example` to `.env` if you want custom settings.

Important env keys for your hackathon account:

```bash
AWS_PROFILE=778015578217_slalom_lsbUsersPS
AWS_REGION=eu-central-1
NOVA_PRO_ID=eu.amazon.nova-pro-v1:0
NOVA_LITE_ID=eu.amazon.nova-lite-v1:0
S3_OUTPUT_BUCKET=s3://nova-sentinel-logs-778015578217/outputs/
```

4. Start everything:

```bash
npm run dev
```

Services:

- dashboard: [http://localhost:3001](http://localhost:3001)
- API/events: [http://localhost:3000](http://localhost:3000)

## Example UI/UX session payload

Send to `POST /api/sessions/start`:

```json
{
  "runConfig": {
    "startUrl": "https://example.com/store",
    "goal": "UI/UX audit (coverage)",
    "testMode": "uiux",
    "exploration": {
      "strategy": "coverage-driven",
      "urlFrontierEnabled": true,
      "canonicalizeUrls": true,
      "depthLimit": 6
    },
    "budgets": {
      "maxSteps": 40,
      "timeBudgetMs": 300000
    },
    "artifacts": {
      "captureHtml": true,
      "captureA11ySnapshot": true,
      "captureVideo": "always"
    },
    "uiux": {
      "viewports": [
        { "label": "mobile", "width": 390, "height": 844 },
        { "label": "tablet", "width": 768, "height": 1024 },
        { "label": "desktop", "width": 1440, "height": 900 }
      ],
      "artifactRetention": {
        "maxSnapshotsPerViewport": 4,
        "keepOnlyFailedOrFlaggedSteps": true,
        "keepDomForIssuesOnly": true
      }
    },
    "safety": {
      "destructiveActionPolicy": "strict",
      "paymentWallStop": true
    }
  }
}
```

## Example functional session payload (safe submits)

Send to `POST /api/sessions/start`:

```bash
curl -sS -X POST http://localhost:3000/api/sessions/start \
  -H "Content-Type: application/json" \
  -d '{
    "runConfig": {
      "startUrl": "https://example.com/store",
      "goal": "Functional smoke-pack with controlled search/filter/pagination submits",
      "testMode": "functional",
      "profileTag": "functional-local",
      "budgets": {
        "maxSteps": 30,
        "timeBudgetMs": 240000
      },
      "functional": {
        "strategy": "smoke-pack",
        "maxFlows": 6,
        "maxStepsPerFlow": 12,
        "allowFormSubmit": true,
        "allowedSubmitTypes": ["search", "filter", "pagination"],
        "testDataProfile": "synthetic",
        "loginAssist": {
          "enabled": true,
          "timeoutMs": 180000,
          "resumeStrategy": "restart-flow"
        },
        "profile": {
          "requireProfileTag": true,
          "reuseProfileAcrossRuns": true
        },
        "assertions": {
          "failOnConsoleError": true,
          "failOn5xx": true
        },
        "contracts": {
          "failOnApi5xx": true,
          "warnOnThirdPartyFailures": true,
          "endpointAllowlistPatterns": ["/api/*", "/graphql"],
          "endpointBlocklistPatterns": ["/api/analytics/*"]
        }
      },
      "safety": {
        "destructiveActionPolicy": "strict",
        "paymentWallStop": true
      }
    }
  }'
```

Functional baseline write example (stores metadata only in `backend/baselines/functional/functional-release.json`):

```bash
curl -sS -X POST http://localhost:3000/api/sessions/start \
  -H "Content-Type: application/json" \
  -d '{
    "runConfig": {
      "startUrl": "https://example.com/store",
      "goal": "Functional baseline write",
      "testMode": "functional",
      "profileTag": "functional-local",
      "functional": {
        "strategy": "smoke-pack",
        "allowFormSubmit": true,
        "contracts": {
          "failOnApi5xx": true,
          "warnOnThirdPartyFailures": true
        },
        "baseline": { "baselineId": "functional-release", "mode": "write" }
      }
    }
  }'
```

Functional baseline compare example (returns `report.functional.baselineDiff`):

```bash
curl -sS -X POST http://localhost:3000/api/sessions/start \
  -H "Content-Type: application/json" \
  -d '{
    "runConfig": {
      "startUrl": "https://example.com/store",
      "goal": "Functional baseline compare",
      "testMode": "functional",
      "profileTag": "functional-local",
      "functional": {
        "strategy": "smoke-pack",
        "allowFormSubmit": true,
        "contracts": {
          "failOnApi5xx": true,
          "warnOnThirdPartyFailures": true
        },
        "baseline": { "baselineId": "functional-release", "mode": "compare" }
      }
    }
  }'
```

## Example accessibility session payload

Send to `POST /api/sessions/start`:

```bash
curl -sS -X POST http://localhost:3000/api/sessions/start \
  -H "Content-Type: application/json" \
  -d '{
    "runConfig": {
      "startUrl": "https://example.com/store",
      "goal": "Accessibility coverage scan",
      "testMode": "accessibility",
      "budgets": {
        "maxSteps": 30,
        "timeBudgetMs": 240000
      },
      "accessibility": {
        "strategy": "coverage-a11y",
        "maxPages": 20,
        "ruleset": "wcag-lite",
        "failOnCritical": true,
        "baseline": {
          "baselineId": "a11y-release",
          "mode": "off"
        }
      },
      "exploration": {
        "strategy": "coverage-driven",
        "urlFrontierEnabled": true,
        "canonicalizeUrls": true,
        "depthLimit": 6
      },
      "artifacts": {
        "captureHtml": true,
        "captureA11ySnapshot": true,
        "captureVideo": "fail-only"
      },
      "safety": {
        "destructiveActionPolicy": "strict",
        "paymentWallStop": true
      }
    }
  }'
```

## Local responsive smoke path (bounded)

Use this for a quick UI/UX validation pass with retention enabled:

```bash
curl -sS -X POST http://localhost:3000/api/sessions/start \
  -H "Content-Type: application/json" \
  -d '{
    "runConfig": {
      "startUrl": "https://example.com/store",
      "goal": "UI/UX responsive smoke",
      "testMode": "uiux",
      "exploration": {
        "strategy": "coverage-driven",
        "urlFrontierEnabled": true,
        "canonicalizeUrls": true,
        "depthLimit": 3
      },
      "budgets": {
        "maxSteps": 8,
        "timeBudgetMs": 90000
      },
      "artifacts": {
        "captureHtml": true,
        "captureA11ySnapshot": true,
        "captureVideo": "fail-only"
      },
      "uiux": {
        "viewports": [
          { "label": "mobile", "width": 390, "height": 844 },
          { "label": "tablet", "width": 768, "height": 1024 },
          { "label": "desktop", "width": 1440, "height": 900 }
        ],
        "artifactRetention": {
          "maxSnapshotsPerViewport": 2,
          "keepOnlyFailedOrFlaggedSteps": true,
          "keepDomForIssuesOnly": true
        }
      },
      "safety": {
        "destructiveActionPolicy": "strict",
        "paymentWallStop": true
      }
    }
  }'
```

Expected smoke verification:
- run completes without crash
- UI/UX summary shows issue counts grouped per viewport
- artifact retention summary shows retained/pruned counts

Cross-page consistency run example:

```bash
curl -sS -X POST http://localhost:3000/api/sessions/start \
  -H "Content-Type: application/json" \
  -d '{
    "runConfig": {
      "startUrl": "https://example.com/store",
      "goal": "UI/UX cross-page consistency audit",
      "testMode": "uiux",
      "exploration": {
        "strategy": "coverage-driven",
        "urlFrontierEnabled": true,
        "canonicalizeUrls": true,
        "depthLimit": 5
      },
      "budgets": { "maxSteps": 20, "timeBudgetMs": 180000 },
      "artifacts": {
        "captureHtml": true,
        "captureA11ySnapshot": true,
        "captureVideo": "fail-only"
      },
      "uiux": {
        "viewports": [
          { "label": "mobile", "width": 390, "height": 844 },
          { "label": "desktop", "width": 1440, "height": 900 }
        ],
        "artifactRetention": {
          "maxSnapshotsPerViewport": 3,
          "keepOnlyFailedOrFlaggedSteps": true,
          "keepDomForIssuesOnly": true
        }
      },
      "safety": { "destructiveActionPolicy": "strict", "paymentWallStop": true }
    }
  }'
```

Baseline write example (stores metadata only in `backend/baselines/uiux/release-smoke.json`):

```bash
curl -sS -X POST http://localhost:3000/api/sessions/start \
  -H "Content-Type: application/json" \
  -d '{
    "runConfig": {
      "startUrl": "https://example.com/store",
      "goal": "UI/UX baseline write",
      "testMode": "uiux",
      "exploration": { "strategy": "coverage-driven", "urlFrontierEnabled": true, "canonicalizeUrls": true, "depthLimit": 4 },
      "budgets": { "maxSteps": 16, "timeBudgetMs": 180000 },
      "uiux": {
        "baseline": { "baselineId": "release-smoke", "mode": "write" }
      },
      "safety": { "destructiveActionPolicy": "strict", "paymentWallStop": true }
    }
  }'
```

Baseline compare example (returns `report.uiux.baselineDiff`):

```bash
curl -sS -X POST http://localhost:3000/api/sessions/start \
  -H "Content-Type: application/json" \
  -d '{
    "runConfig": {
      "startUrl": "https://example.com/store",
      "goal": "UI/UX baseline compare",
      "testMode": "uiux",
      "exploration": { "strategy": "coverage-driven", "urlFrontierEnabled": true, "canonicalizeUrls": true, "depthLimit": 4 },
      "budgets": { "maxSteps": 16, "timeBudgetMs": 180000 },
      "uiux": {
        "baseline": { "baselineId": "release-smoke", "mode": "compare" }
      },
      "safety": { "destructiveActionPolicy": "strict", "paymentWallStop": true }
    }
  }'
```

## AWS-backed mode

The default build works without cloud credentials. To turn on Bedrock-backed planning/reasoning:

1. Configure AWS credentials locally.
2. Enable access in Amazon Bedrock for the models you want to use.
3. Set:

```bash
BEDROCK_ENABLED=true
EXPLORER_PROVIDER=bedrock
AUDITOR_PROVIDER=bedrock
AWS_REGION=us-east-1
NOVA_PRO_ID=eu.amazon.nova-pro-v1:0
NOVA_LITE_ID=eu.amazon.nova-lite-v1:0
```

If you want async Reel output, also set:

```bash
EVIDENCE_PROVIDER=nova-reel
NOVA_REEL_MODEL_ID=amazon.nova-reel-v1:1
S3_OUTPUT_BUCKET=s3://your-bucket/qa-artifacts
```

## Important implementation note

Your original brief assumes `Nova Act` actions come from Bedrock Converse. Current AWS APIs separate those concerns:

- Bedrock Converse is the clean Node path for multimodal planning/reasoning today
- Nova Reel is async video generation, not literal stitching of ten screenshots
- this project therefore uses local MP4 stitching for evidence now, with optional Bedrock/Nova hooks where they fit

That keeps the Node app fully runnable now while preserving the agent boundaries you asked for.

For your current hackathon account in `eu-central-1`, Bedrock reports Nova as inference-profile-only. The working profile ID for Nova Pro is `eu.amazon.nova-pro-v1:0`.

## What credentials I still need from you for cloud mode

If you want the non-mock AWS path enabled, I need:

- AWS credentials with Bedrock access in your chosen region
- model access enabled for the Nova models you want to use
- an S3 bucket URI for evidence output if you want `nova-reel`
- if you specifically want real Nova Act instead of the current Bedrock/Playwright adapter, the exact Nova Act endpoint/auth details you have access to
