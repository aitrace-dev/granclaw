---
name: vault
description: Use when starting to solve a problem, before committing, after a PR is opened/merged, after accessing Kubernetes, after discovering a bug or finding, or when you need project context. Maintains vault/ as a persistent project wiki.
---

# Project Vault

Persistent project memory organized as a navigable wiki. Read it for context, write to it after every meaningful action.

## When to Use

**Read vault first when:**
- Starting any task (for context before touching code)
- Debugging an unfamiliar issue (check findings/bugs)
- Accessing infrastructure (check what was done before)
- Reviewing a PR (check decisions and past reviews)

**Write to vault after:**
- Completing a commit or PR (update `prs/` and `decisions/`)
- Accessing Kubernetes cluster (update `infrastructure/kubernetes.md`)
- Discovering a bug or unexpected behaviour (update `findings/`)
- Making an architectural decision (update `decisions/`)
- Learning an environment detail (update `infrastructure/environments.md`)
- Completing a PR review (update `reviews/`)

## Vault Location

```
vault/              ← committed to repo (except vault/secrets/)
  index.md          ← start here, links to all sections
  wiki/             ← project knowledge base
  decisions/        ← architecture and design decisions (ADRs)
  reviews/          ← PR and code review notes
  infrastructure/   ← k8s access log, env vars, GCP details
  findings/         ← bugs, surprises, gotchas
  prs/              ← PR-level notes and history
  secrets/          ← gitignored — IPs, credential paths, sensitive details
```

## How to Navigate

1. Read `vault/index.md` — find the relevant section
2. Read that section's `index.md` — find the relevant file
3. Read the specific file only if needed

This keeps token usage minimal. Never read all vault files — only what's relevant.

## vault/secrets/ — Classified Information

`vault/secrets/` is gitignored. Store here:
- IP addresses of clusters, services, ingresses
- Paths to credential files or GCP secret names
- Internal URLs not safe for public repos
- VPN or bastion access details
- Any detail that must not appear in git history

**Never write raw secret values — write where to find them (e.g. `GCP Secret Manager: rna-ai-prod/db-password`).**

## Writing Entries

Each section has its own `index.md` listing entries newest-first. When adding an entry:

1. Create the entry file with date prefix: `YYYY-MM-DD-short-title.md`
2. Add one-line pointer to the section `index.md`

### Entry Templates

**Decision (`decisions/YYYY-MM-DD-title.md`):**
```markdown
# Decision: [Title]
Date: YYYY-MM-DD
PR/Branch: [link or branch name]

## Context
[What problem were we solving?]

## Decision
[What did we decide?]

## Consequences
[What changed? What tradeoffs?]
```

**Finding (`findings/YYYY-MM-DD-title.md`):**
```markdown
# Finding: [Title]
Date: YYYY-MM-DD
Severity: low | medium | high

## What Happened
[Description of the bug, surprise, or gotcha]

## Root Cause
[Why did it happen?]

## Resolution
[How was it fixed? PR?]
```

**PR Notes (`prs/YYYY-MM-DD-branch-name.md`):**
```markdown
# PR: [Branch/Title]
Date: YYYY-MM-DD
Branch: [branch name]
PR: [#number or link]
Status: open | merged | closed

## Summary
[What this PR does]

## Key Decisions
[Non-obvious choices made]

## Review Notes
[Feedback received and how it was addressed]
```

**Kubernetes access (`infrastructure/kubernetes.md` — append, don't replace):**
```markdown
## [Date] — [Reason for access]
Cluster: [cluster name / project]
Context: [kubectl context used]
Actions: [what was run]
Finding: [what was learned or changed]
```

**Environment detail (`infrastructure/environments.md` — update in-place):**
Update the relevant env var table directly. Don't create dated entries.

**Secrets (`secrets/credentials.md` or `secrets/ips.md` — update in-place):**
Update the relevant secrets file directly. These files are gitignored.

## Rules

- **Never write raw secrets or credentials** — write location only
- Keep entries short — bullets over paragraphs
- Update `index.md` pointers when adding any file
- `vault/` is committed; `vault/secrets/` is gitignored
