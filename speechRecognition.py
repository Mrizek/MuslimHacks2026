import asyncio
import audioop
import difflib
import os
import re

from deepgram import (
    DeepgramClient,
    LiveTranscriptionEvents,
    LiveOptions,
)
import pyaudio

# Audio Configuration
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 16000
CHUNK = 1024
POINT_VALUES = {
    "love": "0",
    "zero": "0",
    "fifteen": "15",
    "thirty": "30",
    "forty": "40",
    "fourty": "40",
    "advantage": "AD",
    "ad": "AD",
    "deuce": "AD",
}
SCORE_CONFIDENCE_THRESHOLD = 0.78
MIN_AUDIO_RMS = 250
TARGET_AUDIO_RMS = 5000
MAX_AUDIO_GAIN = 4.0
ENDPOINTING_MS = "150"
UTTERANCE_END_MS = "1000"
COMMANDS = {"fault", "correction", "let", "ace"}
NUMERIC_SCORE_VALUES = {"0", "15", "30", "40", "ad"}
SCORE_FILLER_WORDS = {"the", "score", "is", "at", "to", "all"}
CONFIRMATIONS = {"yes", "confirm", "correct", "right"}
REJECTIONS = {"no", "cancel", "wrong", "repeat"}


def is_speech(data):
    """Ignore silent frames before sending audio to the transcription service."""
    return audioop.rms(data, 2) >= MIN_AUDIO_RMS


def enhance_audio(data):
    """Clean and level signed 16-bit mono PCM before transcription."""
    if not data:
        return data

    # Remove microphone DC offset so the speech signal uses the available range.
    data = audioop.bias(data, 2, -audioop.avg(data, 2))
    rms = audioop.rms(data, 2)
    if rms < MIN_AUDIO_RMS:
        return b"\x00" * len(data)

    gain = min(TARGET_AUDIO_RMS / rms, MAX_AUDIO_GAIN)
    return audioop.mul(data, 2, gain)


def correct_score_words(transcript):
    """Map small recognition errors to the closest tennis score word."""
    corrected = []
    score_words = tuple(POINT_VALUES)
    for word in re.findall(r"[a-z]+|\d+", transcript.lower()):
        if word.isdigit():
            corrected.append(word)
            continue
        match = difflib.get_close_matches(word, score_words, n=1, cutoff=0.72)
        corrected_word = match[0] if match else word
        corrected.append({"fourty": "forty"}.get(corrected_word, corrected_word))
    return " ".join(corrected)


def normalize_score_call(transcript):
    """Convert common speech-to-text score variants to a hyphenated score."""
    text = correct_score_words(transcript).replace("-", " ")
    for word, value in POINT_VALUES.items():
        text = re.sub(rf"\b{word}\b", f" {value} ", text)

    values = re.findall(r"(?<!\d)(?:0|15|30|40|ad)(?!\d)", text)
    if len(values) < 2:
        for compact_number in re.findall(r"\d+", text):
            if re.fullmatch(r"(?:40|30|15|0)+", compact_number):
                values.extend(re.findall(r"40|30|15|0", compact_number))

    if len(values) >= 2:
        return f"{values[0].upper()}-{values[1].upper()}"
    return transcript


def classify_call(transcript, confidence):
    """Return an accepted call, a confirmation request, or None."""
    normalized = normalize_score_call(transcript)
    corrected_words = [
        word
        for word in correct_score_words(transcript).split()
        if word not in SCORE_FILLER_WORDS
    ]
    lowered = transcript.lower()
    score_phrase = (
        len(corrected_words) == 2
        and all(word in POINT_VALUES or word in NUMERIC_SCORE_VALUES for word in corrected_words)
    )

    if score_phrase and re.fullmatch(r"(?:0|15|30|40|AD)-(?:0|15|30|40|AD)", normalized):
        if confidence >= SCORE_CONFIDENCE_THRESHOLD:
            return "ACCEPT", normalized
        return "CONFIRM", normalized

    command_words = set(re.findall(r"[a-z]+", lowered))
    if any(command in command_words for command in COMMANDS):
        return "ACCEPT", next(command for command in COMMANDS if command in command_words)

    return None


class ScoreCallTracker:
    def __init__(self):
        self.awaiting_correction = False
        self.pending_call = None

    def handle(self, transcript, confidence, on_verified=None):
        response = transcript.lower().strip(" .,!?\n")
        # Backend actions must happen only through on_verified. At this point,
        # a score has been transcribed but has not yet been confirmed by voice.
        if self.pending_call:
            if response in CONFIRMATIONS:
                verified_call = self.pending_call
                self.pending_call = None
                if on_verified:
                    # verified_call is normalized, for example "30-40".
                    # Connect the database, API, or game-state update here.
                    on_verified(verified_call)
                return "VERIFIED", verified_call
            if response in REJECTIONS:
                self.pending_call = None
                return "REJECTED", "Call discarded; repeat the call"
            return "VERIFY", f"Confirm {self.pending_call} with yes or no"

        decision = classify_call(transcript, confidence)
        if not decision:
            return None

        status, call = decision
        if call.lower() == "correction":
            self.awaiting_correction = True
            return "CORRECTION", "Speak the replacement score"

        if status == "ACCEPT" and self.awaiting_correction:
            self.awaiting_correction = False
        self.pending_call = call
        return "VERIFY", call


def print_call(transcript, confidence=1.0, source="VOICE", tracker=None, on_verified=None):
    tracker = tracker or ScoreCallTracker()
    decision = tracker.handle(transcript, confidence, on_verified=on_verified)
    if not decision:
        print(f"IGNORED Unclear call: {transcript}")
        return None

    status, call = decision
    if status == "VERIFY":
        print(f'VERIFY  Did you say "{call}"? Say yes to send it, or no to reject it.')
    elif status == "REJECTED":
        print(f"REJECTED {call}")
    elif status == "CORRECTION":
        print(f"CORRECTION {call}")
    else:
        print(f"{status:<9} {call} (confidence {confidence:.0%})")
    return status, call


async def main():
    try:
        api_key = os.getenv("DEEPGRAM_API_KEY")
        if not api_key:
            print("Missing DEEPGRAM_API_KEY.")
            print('PowerShell: $env:DEEPGRAM_API_KEY = "your_api_key"')
            return

        client = DeepgramClient(api_key=api_key)
        dg_connection = client.listen.asyncwebsocket.v("1")
        tracker = ScoreCallTracker()

        def on_verified_call(call):
            # Integration point for the rest of the application.
            #
            # `call` is sent here only after the player says yes/confirm/correct/right.
            # Score calls are normalized strings such as "30-40" or "AD-40";
            # commands such as "fault", "let", and "ace" are lowercase strings.
            # Replace this print with the backend operation, for example:
            #   update_match_score(match_id, call)
            #   await api_client.post("/matches/{match_id}/calls", {"call": call})
            # Keep this callback fast, or queue the update for asynchronous work.
            print(f"BACKEND {call}")

        async def on_message(self, result, **kwargs):
            transcript = result.channel.alternatives[0].transcript.strip()
            if not transcript:
                return

            if result.is_final:
                alternative = result.channel.alternatives[0]
                confidence = getattr(alternative, "confidence", 0.0) or 0.0
                print_call(
                    transcript,
                    confidence,
                    tracker=tracker,
                    on_verified=on_verified_call,
                )
                # Do not send `transcript` directly to the backend. The callback
                # above is the verified handoff and prevents false score updates.
            else:
                print(f"...    {transcript}", end="\r")

        async def on_error(self, error, **kwargs):
            print(f"\nDeepgram error: {error}")

        dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)
        dg_connection.on(LiveTranscriptionEvents.Error, on_error)

        options = LiveOptions(
            model="nova-3",
            language="en",
            smart_format=True,
            encoding="linear16",
            channels=CHANNELS,
            sample_rate=RATE,
            interim_results=True,
            vad_events=True,
            utterance_end_ms=UTTERANCE_END_MS,
            endpointing=ENDPOINTING_MS,
            keyterm=[
                "zero",
                "fifteen",
                "thirty",
                "forty",
                "fault",
                "correction",
                "advantage",
            ],
        )

        print("Connecting to Deepgram...")
        if await dg_connection.start(options) is False:
            print("Failed to connect to Deepgram.")
            return

        p = pyaudio.PyAudio()
        stream = p.open(
            format=FORMAT,
            channels=CHANNELS,
            rate=RATE,
            input=True,
            frames_per_buffer=CHUNK,
        )

        print("Microphone is live. Say a tennis score, Fault, or Correction.")
        print("Each call must be verified with Yes/Confirm or rejected with No/Repeat.")
        print("Press Ctrl+C to stop.\n")

        try:
            while True:
                data = stream.read(CHUNK, exception_on_overflow=False)
                enhanced_data = enhance_audio(data)
                if is_speech(enhanced_data):
                    await dg_connection.send(enhanced_data)
                await asyncio.sleep(0.005)
        except KeyboardInterrupt:
            print("\nStopping stream...")
        finally:
            # Clean up audio and socket connections
            stream.stop_stream()
            stream.close()
            p.terminate()
            await dg_connection.finish()
            print("Disconnected.")

    except Exception as error:
        print(f"Could not start voice recognition: {error}")

if __name__ == "__main__":
    asyncio.run(main())
