import asyncio
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
}

COMMANDS = ["fault", "correction", "let", "ace"]

def process_transcript(transcript):
    """Normalize score calls or pass through valid single-word commands."""
    text = transcript.lower().strip()
    
    # Check if the transcript matches a direct command
    for cmd in COMMANDS:
        if cmd in text:
            return cmd

    # Otherwise, attempt score parsing
    cleaned_text = text.replace("-", " ")
    for word, value in POINT_VALUES.items():
        cleaned_text = re.sub(rf"\b{word}\b", f" {value} ", cleaned_text)

    values = re.findall(r"(?<!\d)(?:0|15|30|40|ad)(?!\d)", cleaned_text)
    if len(values) >= 2:
        return f"{values[0].upper()}-{values[1].upper()}"
        
    return text


def print_call(transcript, source="VOICE"):
    result = process_transcript(transcript)
    print(f"{source:<6} {result}")


async def main():
    try:
        api_key = "1ba157bf5683dd8b441996773275451e83f3b168"
        if not api_key:
            print("Missing DEEPGRAM_API_KEY.")
            print('PowerShell: $env:DEEPGRAM_API_KEY = "your_api_key"')
            return

        client = DeepgramClient(api_key=api_key)
        dg_connection = client.listen.asyncwebsocket.v("1")

        async def on_message(self, result, **kwargs):
            transcript = result.channel.alternatives[0].transcript.strip()
            if not transcript:
                return

            if result.is_final:
                print_call(transcript)
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
            keyterm=[
                "zero",
                "fifteen",
                "thirty",
                "forty",
                "fault",
                "correction",
                "advantage",
            ],
            # Force server-side correction for common acoustic mismatches
            replace=[
                "fold:fault",
                "holds:fault",
                "hold:fault",
                "folds:fault",
                "honks:fault",
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
        print("Press Ctrl+C to stop.\n")

        try:
            while True:
                data = stream.read(CHUNK, exception_on_overflow=False)
                await dg_connection.send(data)
                await asyncio.sleep(0.005)
        except KeyboardInterrupt:
            print("\nStopping stream...")
        finally:
            stream.stop_stream()
            stream.close()
            p.terminate()
            await dg_connection.finish()
            print("Disconnected.")

    except Exception as error:
        print(f"Could not start voice recognition: {error}")

if __name__ == "__main__":
    asyncio.run(main())