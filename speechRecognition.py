import asyncio
import os

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


async def main():
    try:
        api_key = os.getenv("DEEPGRAM_API_KEY")
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
                print(f"CALL  {transcript}")
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
