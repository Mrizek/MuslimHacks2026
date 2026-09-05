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

Speak score calls such as `40-30`, `Fault`, or `Correction`. Interim transcripts appear while speaking; final calls are printed with the `CALL` label. Press `Ctrl+C` to stop.
