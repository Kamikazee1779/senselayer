# Interchangeable OpenAI context adapter

The existing provider interface now accepts `CONTEXT_PROVIDER=openai`. It uses the official OpenAI Node SDK and Responses API with strict structured output. `OPENAI_CONTEXT_MODEL` defaults to `gpt-5.6-terra`; `OPENAI_API_KEY` stays on the server and is shared with the existing STT setup. `mock` is still the default. Switch back to `CONTEXT_PROVIDER=claude` with the existing Anthropic variables without changing other code.

The model receives active semantic state (including seen but unfinished tasks), up to 40 older transcript events, the explicit `new_events` batch, and configured user names. Instructions distinguish commitments from preferences, explicit answers from speculation, and actionable requests from ordinary name mentions. Decision proposals may include an optional explicit rationale with its own source IDs. Request proposals distinguish conversational questions from tasks; accepting a task does not complete it. No new semantic operation type is required. Vendor-specific nullable fields are normalized inside the adapter. The common reducer validates every proposal regardless of provider.

The SDK's strict schema requires nullable optional reference fields; the adapter removes null references and passes proposals through the existing `parseDeltaOps`. Every citation must exist and at least one must belong to the new batch. The reducer still validates and owns all mutations, IDs, timestamps, lifecycles, supersession and watermarks. Requests have a 15-second SDK timeout and no automatic SDK retries. Existing application retry/cursor behavior is unchanged. API refusals, incomplete output, invalid JSON/schema/evidence and errors fail the batch.

## Real-provider smoke test

Stop the existing `pnpm dev` process first so the restarted backend reads the environment. Set `OPENAI_API_KEY` and `CONTEXT_PROVIDER=openai` in the root `.env`, which the backend loads automatically. Alternatively, from the repository root in PowerShell, with `OPENAI_API_KEY` already exported in this shell:

```powershell
pnpm install
$env:CONTEXT_PROVIDER = 'openai'
$env:OPENAI_CONTEXT_MODEL = 'gpt-5.6-terra'
pnpm dev
```

Do not use `VITE_OPENAI_API_KEY`. No new API key or STT changes are needed. Existing Claude variables are unused in OpenAI mode.

Open the app and follow the project-meeting script in [demo.md](demo.md). Observe processing status: `POST /transcript` confirms acceptance, not completion of model interpretation. To automate acceptance, poll `GET /session` until `processing.status` is `ready` before checking `state`; fail the check on `error`.

Check that a suggestion creates no decision, a committed correction replaces the previous plan, an explicit reason has valid sources, and a seen task remains pending until completed. Verify sources through the catch-up panel. Record actual latency separately from simulated tests.

The model adapter remains replaceable through `ContextProvider` and `CONTEXT_PROVIDER`; speech recognition is configured separately. A provider switch requires no UI or reducer changes. No automatic fallback conceals provider errors.

## Automated checks

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm replay
```

The adapter tests use the real SDK with mocked HTTP responses, checking structured format, metadata ownership, active context, evidence rules, malformed/refused/truncated output, timeout propagation, retry/cursor preservation and the dinner fixture's state transitions. All earlier tests remain in place.

References: [Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra).
