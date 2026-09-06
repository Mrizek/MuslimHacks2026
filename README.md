# Tennis Voice Recognition

A focused Deepgram microphone stream for recognizing tennis score calls.

## Run

From this folder:

```powershell
python server.py
```

Set `DEEPGRAM_API_KEY`, then run:

```powershell
python speechRecognition.py
```

Speak score calls such as `40-30`, `Fault`, or `Correction`. Microphone frames are cleaned before transcription: DC offset is removed, quiet/noise-only frames are suppressed, and speech is given bounded automatic gain. Every recognized call is held for verification: say `yes`, `confirm`, `correct`, or `right` to send it to the backend callback, or say `no`, `cancel`, `wrong`, or `repeat` to discard it. Nothing reaches the backend before verification. Silent/low-energy microphone frames are filtered locally, and only exact score-shaped calls are accepted, which helps reject speech from adjacent courts. Common variants such as `fourty` are corrected before parsing, while unrelated phrases are printed as `IGNORED`.

Connect backend score/state updates in `on_verified_call(call)` inside `speechRecognition.py`. It receives normalized values such as `30-40` only after confirmation.

A single microphone cannot reliably spatially separate two courts. For strong adjacent-court interference, use a directional microphone close to the umpire or one microphone per court. Press `Ctrl+C` to stop.
