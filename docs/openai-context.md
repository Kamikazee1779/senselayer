# Temporary OpenAI context provider

The existing provider interface now accepts `CONTEXT_PROVIDER=openai`. It uses the official OpenAI Node SDK and Responses API with strict structured output. `OPENAI_CONTEXT_MODEL` defaults to `gpt-5.6-terra`; `OPENAI_API_KEY` stays on the server and is shared with the existing STT setup. `mock` is still the default. Switch back to `CONTEXT_PROVIDER=claude` with the existing Anthropic variables without changing other code.

The model receives active semantic state, up to 40 older transcript events, the explicit `new_events` batch, and configured user names. Instructions distinguish commitments from preferences, explicit answers from speculation, and actionable requests from ordinary name mentions. There is no phrase-based production classifier or new operation type.

The SDK's strict schema requires nullable optional reference fields; the adapter removes null references and passes proposals through the existing `parseDeltaOps`. Every citation must exist and at least one must belong to the new batch. The reducer still validates and owns all mutations, IDs, timestamps, lifecycles, supersession and watermarks. Requests have a 15-second SDK timeout and no automatic SDK retries. Existing application retry/cursor behavior is unchanged. API refusals, incomplete output, invalid JSON/schema/evidence and errors fail the batch.

## Real-provider smoke test

Stop the existing `pnpm dev` process first so the restarted backend reads the environment. From the repository root in PowerShell, with the existing `OPENAI_API_KEY` already exported in this shell:

```powershell
pnpm install
$env:CONTEXT_PROVIDER = 'openai'
$env:OPENAI_CONTEXT_MODEL = 'gpt-5.6-terra'
pnpm dev
```

Do not use `VITE_OPENAI_API_KEY`. No new API key or STT changes are needed. Existing Claude variables are unused in OpenAI mode.

In another PowerShell terminal at the repository root, run this against your local demo session. It resets that session, sends each dinner fixture batch to the real semantic provider, and checks the requested milestones:

```powershell
$base = 'http://127.0.0.1:3001'
Invoke-RestMethod "$base/reset" -Method Post -ContentType 'application/json' -Body '{}' | Out-Null
$fixture = Get-Content fixtures/dinner-context.json -Raw | ConvertFrom-Json
for ($i = 0; $i -lt $fixture.batches.Count; $i++) {
  $body = $fixture.batches[$i] | ConvertTo-Json -Depth 10 -Compress
  $result = Invoke-RestMethod "$base/transcript" -Method Post -ContentType 'application/json' -Body $body
  $state = $result.state
  if ($i -eq 1 -and (@($state.questions | Where-Object { $null -eq $_.resolution }).Count -ne 1 -or @($state.decisions).Count -ne 0)) { throw 'Preference incorrectly changed dinner semantics' }
  if ($i -eq 2 -and (@($state.decisions | Where-Object { $_.text -match 'burrito' }).Count -lt 1 -or @($state.questions | Where-Object { $null -ne $_.resolution }).Count -lt 1)) { throw 'Commitment did not decide and resolve dinner' }
  if ($i -eq 3 -and (@($state.user_requests).Count -ne 0 -or @($result.attention).Count -ne 0)) { throw 'Ordinary mention became actionable' }
  if ($i -eq 4 -and (@($state.user_requests).Count -ne 1 -or @($result.attention).Count -ne 1)) { throw 'Direct request was not captured' }
  $result | ConvertTo-Json -Depth 15
}
```

Then open http://127.0.0.1:5173, reset, and repeat the five fixture utterances with **Start microphone**, pausing for each final transcript. Inspect catch-up and priority cards. This manual run exercises real language understanding; automated tests deliberately mock OpenAI and cannot prove model accuracy. The existing `pnpm replay` remains the deterministic offline check, regardless of provider environment variables.

## Automated checks

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm replay
```

The adapter tests use the real SDK with mocked HTTP responses, checking structured format, metadata ownership, active context, evidence rules, malformed/refused/truncated output, timeout propagation, retry/cursor preservation and the dinner fixture's state transitions. All earlier tests remain in place.

References: [Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra).
