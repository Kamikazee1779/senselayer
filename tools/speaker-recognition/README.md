# Local enrolled-speaker identification

This optional Python sidecar compares microphone windows with local ECAPA profiles.
It recognizes enrolled names, or rejects a window as `Unknown`. It does not
transcribe words, separate overlapping voices, or perform general diarization.
The existing transcription and semantic engine continue independently.

The local stack has been checked on an Apple Silicon MacBook Air with Python
3.13.2: imports, model download, offline model loading, synthetic embedding
inference and a three-second physical microphone capture passed. Concurrent
Chrome and Python capture of the built-in microphone also passed, with audio
discarded and both inputs closed afterward. Four profiles were generated from
the supplied Windows enrollment WAVs (Emilio, Ivan, Alexandra and Enrico).
Three-second excerpts from those same recordings matched the expected profiles;
this is a consistency check, not independent accuracy or validation with the
Mac microphone. The working Windows environment and Trust GXT microphone still
need their own integration check.

## macOS setup (Apple Silicon)

The development Mac already has this isolated environment and downloaded model.
To reproduce it with Python 3.13 from the repository root:

```sh
python3.13 -m venv tools/speaker-recognition/.venv
tools/speaker-recognition/.venv/bin/python -m pip install -r tools/speaker-recognition/requirements-macos.lock.txt
HF_HOME="$PWD/tools/speaker-recognition/models/huggingface" tools/speaker-recognition/.venv/bin/python tools/speaker-recognition/speaker_service.py --prewarm
```

The macOS lock records the actual installed environment; it is separate from the
Windows benchmark lock. It includes SpeechBrain 1.1.1, Torch 2.14.0 and TorchAudio
2.11.0. Cached model inference works offline. A synthetic three-second input
produced a normalized 192-value embedding in approximately 0.03–0.06 seconds on
this Mac; that is a computation smoke test, not a voice-accuracy result.

The built-in input is `MacBook Air Microphone` and supports mono float32 at 16 kHz.
Select that device in Chrome as well: this Mac's system default was AirPods at
setup time. macOS may request microphone permission for the terminal/app running
Python and for Chrome. Microphone capture tests discard audio instead of saving
it. Only explicit enrollment commands below save a WAV.

After recording at least two actual people and building their profiles, configure
the local `.env`, substituting the names used for the recording folders:

```dotenv
SENSELAYER_SPEAKER_ID_ENABLED=1
SENSELAYER_SPEAKER_DEVICE_NAME="MacBook Air Microphone"
SENSELAYER_SPEAKER_NAMES=ivan,emilio
```

The server automatically uses `tools/speaker-recognition/.venv/bin/python` on
macOS. Restart it after changing `.env`. Leave the feature disabled until profiles
exist. Then open localhost, choose **Live**, and use the usual microphone button.
Start with one person at a time speaking for roughly 8–10 seconds. Check names
against the original words, and include brief replies and an unenrolled person
before assessing accuracy.

## Reuse the working Windows environment

Run these commands from the repository root in PowerShell. First inspect the
Python and package versions that already passed the team's benchmark:

```powershell
& 'C:\Users\Windows\BainsaHack\speaker-benchmark\.venv\Scripts\python.exe' --version
& 'C:\Users\Windows\BainsaHack\speaker-benchmark\.venv\Scripts\python.exe' -m pip freeze
& 'C:\Users\Windows\BainsaHack\speaker-benchmark\.venv\Scripts\python.exe' -m pip freeze | Set-Content -Encoding utf8 tools\speaker-recognition\requirements-lock.txt
```

`requirements.txt` lists direct dependencies without invented version pins.
`requirements-lock.txt` must come from that working environment before installing
a reproduction. Check that the freeze contains no private URLs or local paths
before sharing it. Reusing the existing environment directly is also supported.

If creating a repository environment, use the same Python version as the
benchmark (the scripts require Python 3.10 or newer):

```powershell
python -m venv tools\speaker-recognition\.venv
tools\speaker-recognition\.venv\Scripts\python.exe -m pip install --upgrade pip setuptools wheel
tools\speaker-recognition\.venv\Scripts\python.exe -m pip install -r tools\speaker-recognition\requirements-lock.txt
tools\speaker-recognition\.venv\Scripts\python.exe -c "import torch, speechbrain, sounddevice, soundfile, numpy, scipy; print('SPEAKER STACK OK')"
```

Do not upgrade the working recognition stack just to match newer package releases.
Enrollment WAVs are read through `soundfile`, never `torchaudio.load`; this input
path does not need TorchCodec. `torchaudio` remains a SpeechBrain dependency.

## Prewarm and create profiles

The public `speechbrain/spkrec-ecapa-voxceleb` model requires an initial download,
but no API key. Prewarm before the demo:

```powershell
tools\speaker-recognition\.venv\Scripts\python.exe tools\speaker-recognition\speaker_service.py --prewarm
tools\speaker-recognition\.venv\Scripts\python.exe tools\speaker-recognition\build_profiles.py --audio-dir 'C:\Users\Windows\BainsaHack\speaker-benchmark\audio'
```

The builder reads the existing `emilio/enroll.wav`, `ivan/enroll.wav`,
`alexandra/enroll.wav` and `enrico/enroll.wav`. It converts channels to mono,
resamples to 16 kHz when necessary, normalizes embeddings, and creates
`profiles/<name>.npy` plus `profiles/manifest.json`. No new enrollment is required.
Edit display names in the manifest if needed; `--names` selects other folder
names, with at least two profiles required for a winner-versus-runner-up margin.

If the Windows recordings have been copied into the repository's local
`speaker-enrollments/` folder, regenerate the four profiles on the Mac with:

```sh
tools/speaker-recognition/.venv/bin/python tools/speaker-recognition/build_profiles.py --audio-dir speaker-enrollments --names emilio,ivan,alexandra,enrico
```

Both that enrollment folder and the generated profiles are ignored by Git.

Both scripts accept `--model-dir` and `--profiles-dir`; their defaults are relative
to this directory, independent of the working directory. `build_profiles.py`
also supports `--prewarm` without enrollment input.

## Record local enrollment audio on macOS

After installing the local environment, list the available inputs. This command
does not capture audio or load the speaker model:

```sh
tools/speaker-recognition/.venv/bin/python tools/speaker-recognition/record_enrollment.py --list-devices
```

Record one person at a time, speaking naturally for 30 seconds in a quiet room.
The default input name is `MacBook Air Microphone`; if your Mac uses a different
name, pass `--device-name 'MacBook Pro Microphone'` or `--device INDEX` using the
index printed above. These CLI choices take precedence over microphone settings
in the shell. The script asks you to press Enter and counts down before capture;
macOS may also request microphone access for your terminal.

```sh
tools/speaker-recognition/.venv/bin/python tools/speaker-recognition/record_enrollment.py --name ivan
tools/speaker-recognition/.venv/bin/python tools/speaker-recognition/record_enrollment.py --name emilio
```

Each recording is saved locally as `enrollments/<name>/enroll.wav`, at 16 kHz mono.
The folder is ignored by Git. `--seconds` accepts 5–60 seconds; `--overwrite` is
required to replace an existing recording. Ctrl+C cancels capture without saving
an incomplete WAV. Near-silent recordings are rejected; a non-silent recording
still needs to contain only the intended speaker's voice.

You can record yourself now and add another person later. Profile building and
recognition require at least two enrolled people to compare the best and second
best matches. Once both recordings exist, build only those names:

```sh
tools/speaker-recognition/.venv/bin/python tools/speaker-recognition/build_profiles.py --audio-dir tools/speaker-recognition/enrollments --names ivan,emilio
```

Use the same physical input for enrollment, browser transcription and Python
recognition when testing the live app.

## Microphone and configuration

Set `SENSELAYER_SPEAKER_ID_ENABLED=1` on the Node server to opt in. Set
`SENSELAYER_SPEAKER_PYTHON` to the absolute path of the verified environment's
Python interpreter. `.env.example` documents the server integration. The Python
scripts read process environment variables; when run standalone they do not
automatically load the repository `.env`.

For example, after prewarming and building the profiles with the same interpreter,
add to the repository `.env` (forward slashes work for the Windows path):

```dotenv
SENSELAYER_SPEAKER_ID_ENABLED=1
SENSELAYER_SPEAKER_PYTHON=C:/Users/Windows/BainsaHack/speaker-benchmark/.venv/Scripts/python.exe
SENSELAYER_SPEAKER_DEVICE_NAME="Trust GXT 232"
```

Restart the Node server. Open `http://127.0.0.1:5173`, select the Trust GXT input
in Chrome, and turn on the existing microphone button. Node verifies both device
names before accepting observations. It launches Python only for that capture
session; microphone off also stops Python. Logs appear in the server terminal.
This independent-capture prototype is intentionally unavailable to remote/mobile
browsers. See [live integration details](../../docs/live-stt.md).

Python settings:

| Variable suffix (`SENSELAYER_SPEAKER_…`) | Default | Meaning |
| --- | --- | --- |
| `SAMPLE_RATE` | `16000` | Required sample rate for this model |
| `WINDOW_SEC` | `3.0` | Duration of each inference window |
| `HOP_SEC` | `1.5` | Advance between overlapping windows |
| `MIN_SCORE` | `0.30` | Minimum best cosine similarity |
| `MIN_MARGIN` | `0.08` | Minimum difference from the second-best match |
| `MIN_RMS` | `0.003` | Skip windows below this energy |
| `DEVICE_INDEX` | unset | Explicit sounddevice input index, if provided |
| `DEVICE_NAME` | `Trust GXT 232` | Input name to search for if no index is set |
| `NAMES` | all manifest names | Optional comma-separated profile folder names |

Device discovery uses an explicitly supplied index first, then a matching input
name with an MME preference, then the default system input. The selected name is
logged on stderr. Do not assume index `1` on a different machine. An invalid
explicit index fails instead of silently recording a different input.

Standalone diagnostic run:

```powershell
$env:SENSELAYER_SPEAKER_DEVICE_INDEX = '1'
tools\speaker-recognition\.venv\Scripts\python.exe tools\speaker-recognition\speaker_service.py
```

Stop with Ctrl+C, or send `{"type":"stop"}` followed by a newline on stdin. EOF
also stops capture. The Node adapter owns the process lifecycle and must launch
it only during an explicitly started live microphone session. The input stream
closes on a control thread even if an embedding is still being computed.

## Wire contract and conservative attribution

stdout contains JSON lines only; Python imports, model logs and diagnostics go
to stderr. The service emits `ready` only after model/profile loading and a
successful microphone start:

```json
{"type":"ready","deviceName":"Micrófono (Trust GXT 232 Microphone) (MME)"}
{"type":"speaker_identity","speaker":"Emilio","score":0.64,"margin":0.14,"startMs":1790427600000,"endMs":1790427603000}
```

`startMs` and `endMs` are epoch milliseconds for **audio capture**, not for the
completion of inference. The adapter associates observations with the matching
transcript audio interval; it must not look up the most recent name when delayed
transcription text arrives. This intentionally improves on the initial proposal's
`recognizedAt`/`getLatestSpeaker()` contract.

Python emits raw per-window matches or rejections. It never carries an old name
into a rejected window; temporal consensus belongs in the Node adapter where it
can consider the transcript interval. Silence emits no observation. Cosine
scores are similarities, not confidence percentages. A mixed-speaker window can
still produce a high score: these thresholds do not detect all overlapping speech.

Node requires two agreeing, fully contained windows with no gaps, at least 80%
coverage of the committed audio chunk, and no conflicting overlapping observation.
At default settings, turns below 4.5 seconds remain `Unknown`; longer turns can
also lack enough coverage. The first chunk, startup, long pauses and delayed
inference can reduce coverage. Text is never held up to wait for recognition.
`SENSELAYER_SPEAKER_STALE_MS` (default 5000) rejects observations whose inference
arrives too late relative to audio capture; it is not a timeout on STT delivery.
Normal stop retains recent evidence for delayed text, while failure/reset clears it.

The capture callback only copies bounded chunks into a queue; inference runs
outside it. Missing queue blocks, audio overflows or capture clock gaps reset the
accumulation window so discontinuous audio is not mislabeled as continuous.
Live audio stays in memory and is never saved. Profiles, enrollment audio,
downloaded models and the virtual environment must remain untracked.

This setup assumes the browser and Python use the **same physical microphone on
the server's machine**. Opening the web app on a phone does not make the server's
microphone listen to that phone. Verify simultaneous browser and Python access on
the Windows demo machine before relying on speaker labels.

## Verification

Dependency-free checks, runnable without SpeechBrain or a microphone:

```powershell
python -m unittest discover -s tools/speaker-recognition -p 'test_*.py'
python -m py_compile tools/speaker-recognition/speaker_policy.py tools/speaker-recognition/ecapa.py tools/speaker-recognition/build_profiles.py tools/speaker-recognition/speaker_service.py
```

The policy tests cover both rejection thresholds, invalid scores, changing raw
identities and discontinuities in captured audio. Fake-device tests check input
selection and stop/EOF capture shutdown. Node tests cover temporal attribution
and process failures. No automated test needs a real microphone.

On the actual demo machine, verify:

1. Prewarm succeeds and all four profiles build from the existing WAVs.
2. Python selects the Trust GXT input while browser transcription also works.
3. Emilio, Ivan, Alexandra and Enrico speak in alternating turns, including short
   replies; check names against the words actually spoken, not the current voice.
4. A non-enrolled person and ambiguous turns remain unknown where evidence is weak.
5. Muting or leaving live mode closes Python capture; a missing Python process,
   unavailable profile or microphone failure leaves transcription working.

The earlier 12/12 five-second closed-set samples and one unknown participant are
promising enrollment results, not proof of live conversational accuracy. Verify
three-second windows, latency, brief turns and overlapping speech on the real
hardware before describing the feature as validated.
