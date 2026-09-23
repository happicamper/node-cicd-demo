# Secure CI/CD Pipeline on AWS ECS Fargate

A CI/CD pipeline for a containerized Node.js app, deployed to
AWS ECS Fargate via GitHub Actions — with a full security gate chain
(secrets scanning, SCA, SAST, DAST) and a two-environment promotion flow with
a manual approval gate before production.

A portfolio project to demonstrate DevSecOps practices

## Architecture

```mermaid
flowchart TD
    subgraph CI["Every push / PR"]
        A[Secret Scan<br/>Gitleaks] --> E[Build & Scan Image]
        B[Dependency Scan<br/>Trivy] --> E
        C[SAST<br/>Semgrep] --> E
        D[Unit Tests<br/>Jest + Supertest] --> F[DAST Baseline<br/>ZAP, ephemeral container]
        F --> E
    end

    E -->|push to main only| G[Push to ECR]
    G --> H[Deploy to Staging<br/>ECS Fargate Spot]
    H --> I[DAST Full Scan<br/>ZAP active scan vs live staging]
    I --> J[Manual Approval Gate<br/>GitHub Issue-based]
    J --> K[Deploy to Production<br/>ECS Fargate]
    K -->|smoke test fails| L[Automatic Rollback]

    style E fill:#2d333b,stroke:#768390,color:#fff
    style I fill:#5c2b29,stroke:#f47067,color:#fff
    style J fill:#3c3a1f,stroke:#e3b341,color:#fff
    style K fill:#1b4721,stroke:#3fb950,color:#fff
```

One VPC, one ALB, one ECS cluster — staging and production run as separate
ECS services sharing the load balancer on different ports, so the whole
two-environment setup costs roughly what a single environment would.

## Pipeline stages

| Stage | Tool | What it catches | Blocks the build? |
|---|---|---|---|
| Secret scan | [Gitleaks](https://github.com/gitleaks/gitleaks) | Committed credentials | Yes |
| Dependency scan (SCA) | [Trivy](https://github.com/aquasecurity/trivy) | Known CVEs in `node_modules` | Yes (CRITICAL/HIGH, fixable only) |
| SAST | [Semgrep](https://semgrep.dev/) | Unsafe code patterns, OWASP Top 10 | Yes |
| Unit tests | Jest + Supertest | Functional correctness, security-header regressions | Yes |
| DAST (baseline) | [OWASP ZAP](https://www.zaproxy.org/) | Passive scan against an ephemeral container, every PR | No (report only) |
| Image scan | Trivy | OS/library CVEs in the built container | Yes |
| SBOM | Trivy (CycloneDX) | Full manifest of everything in the image | — |
| DAST (full) | OWASP ZAP | **Active** scan against live staging — real attack payloads | Yes |

Every scanner reports in two formats: SARIF for future code-scanning
integration, plus a plain-text/table report uploaded as a workflow artifact —
so results are readable without needing GitHub Advanced Security (a paid
feature this repo doesn't rely on).

## Proof of Concept(Screenshots)
### Deployment Overview
<img width="2071" height="726" alt="deployment_overview2" src="https://github.com/user-attachments/assets/22e04d71-48ca-49b7-b0ca-c941ce937b84" />

### AWS VPC
<img width="1702" height="969" alt="vpc" src="https://github.com/user-attachments/assets/eed899cf-4607-4564-bb97-12d8e31f50a3" />

### ECS Cluster Service
<img width="1910" height="1082" alt="ecs-cluster3" src="https://github.com/user-attachments/assets/9cd0ed54-562a-4993-a87b-dcbb00b31283" />

### Application Endpoint
- /
<img width="1089" height="233" alt="node-app-version1" src="https://github.com/user-attachments/assets/4cc44e73-8169-4638-9627-ccecf907ed18" />

- /health
<img width="683" height="220" alt="node-app-health" src="https://github.com/user-attachments/assets/23f6d7f0-67c5-4be4-b8c2-d3629dfda3f6" />

- /version
<img width="1349" height="278" alt="node-app-version_page" src="https://github.com/user-attachments/assets/240a8494-c4a6-4737-af73-38b2ba25d57b" />

## Environment promotion

- **Staging** deploys automatically on every push to `main`, runs on Fargate
  Spot (~70% cheaper), and is where the full DAST attack scan runs.
- **Production** only deploys after staging's DAST scan passes *and* a human
  approves — implemented via a GitHub Issue-based approval gate as an alternative
  for GitHub's native required-reviewers feature due to cost.
- Production deploys record the previous task definition before rolling out,
  and automatically roll back to it if the post-deploy smoke test fails.

## Security decisions worth noting

- **Every third-party GitHub Action is pinned to a full commit SHA**, not a
  mutable version tag — a direct response to the real `trivy-action`
  supply-chain compromise (March 2026), where 76 of 77 version tags were
  force-pushed to malicious commits.
- **OIDC, not static AWS keys.** The GitHub Actions role is assumed per-run
  via GitHub's OIDC provider, scoped tightly by the JWT `sub` claim to this
  specific repository.
- **Least-privilege IAM.** The deploy role can only read/register task
  definitions (an AWS API limitation — no scoping possible), update two
  *named* ECS services, and pass exactly two specific IAM roles to ECS.
- **PRs never get AWS credentials.** Building and scanning the image happens
  entirely against a local Docker tag; AWS auth only happens on the actual
  push-to-`main` path that pushes to ECR.
- **Non-root container, stripped build tooling.** The final image runs as the
  `node` user and has `npm`/`npx` removed post-build, eliminating CVEs that
  live in tooling never used at runtime.

## Real issues found and fixed by this pipeline

The DAST full-scan stage against a live staging deployment caught genuine
findings, not synthetic ones — the kind of thing header-only linting doesn't:

- Missing `X-Content-Type-Options`, leaking `X-Powered-By`, no
  `Permissions-Policy` — fixed via [Helmet](https://helmetjs.github.io/).
- A subtler one: Express's built-in `finalhandler` was **silently overwriting**
  Helmet's Content-Security-Policy header (`default-src 'none'`) on any
  unmatched route (e.g. `/robots.txt`), dropping the `frame-ancestors`,
  `base-uri`, and `form-action` directives that don't fall back to
  `default-src`. Fixed with an explicit catch-all 404 handler, and pinned in
  place with a regression test so it can't silently come back.

## Tech stack

**App:** Node.js 24, Express 5, Helmet
**Infra:** Terraform (`terraform-aws-modules`), AWS ECS Fargate, ALB, ECR
**CI/CD:** GitHub Actions, OIDC-based AWS auth
**Security:** Gitleaks, Trivy, Semgrep, OWASP ZAP
**Testing:** Jest, Supertest

## Running it locally

```bash
cd app
npm install
npm test
npm start
```

Or via Docker, matching exactly what CI builds:

```bash
docker build -t app:local .
docker run -p 3000:3000 app:local
curl http://localhost:3000/health
```

## Limitations

This is a deliberately cheap, single-account setup for portfolio purposes only.
It is worth mentioning what are the things we could change in industry standard
setup:

- **Separate AWS accounts per environment** this project uses a single account setup
- **GitHub's native required-reviewers** this project uses an issue-based approval
  workaround
- A **host-based ALB routing / Domain** this projects seperates the two environment
  URLS using ports.
