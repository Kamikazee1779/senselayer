# Contributing to SenseLayer

SenseLayer is being developed under hackathon time pressure, so the collaboration rule is simple: **small changes, explicit ownership, green checks**.

## Before coding

1. Pull the latest `main`.
2. Create a short-lived branch for your change.
3. Avoid editing shared contracts unless the change genuinely requires it.
4. Never commit API keys, `.env` files, credentials, or local machine paths.

```bash
git pull origin main
git switch -c <short-branch-name>
```

## Ownership guide

- `apps/server/` — context engine, providers, state, API, STT server boundary.
- `apps/web/` — product UI and microphone client.
- `packages/shared/` — contracts used by both sides; coordinate before changing.
- `fixtures/` — replay and acceptance scenarios.
- `tests/` — regression coverage.
- `docs/` — architecture, setup, demo runbooks.

## Before pushing

Run the core gate:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm replay
```

If your change touches microphone/UI behavior, also run the relevant browser tests when available.

## Pull requests

Keep PRs narrow. In the description, state:

- what changed;
- why it matters for the demo/product;
- what was deliberately not changed;
- tests/checks run;
- any risk or fallback.

Prefer fixing one real failure mode over adding several speculative features.

## Scope discipline

Before the hackathon demo, avoid introducing unless strictly required:

- database/persistence infrastructure;
- authentication;
- diarization as a dependency;
- emotion/sarcasm inference;
- new semantic operation types;
- large UI rewrites;
- unrelated refactors.

## Product invariants

Changes should preserve these principles:

1. **Quiet by default. Relevant when needed.**
2. **Explicit evidence beats inference.**
3. **Models propose; application code owns state.**
4. **I MISSED THAT is a deterministic change window, not a generic rolling summary.**
5. **Talking about the user is not the same as talking to the user.**
6. **Replay and live STT converge at the same finalized transcript boundary.**

## Secrets

Use environment variables locally. The repository contains only `.env.example` placeholders.

Never place real credentials in:

- source code;
- screenshots;
- issue/PR text;
- `VITE_*` variables;
- committed shell scripts.
