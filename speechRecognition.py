# # import asyncio
# # import audioop
# # import difflib
# # import os

# # from deepgram import (
# #     DeepgramClient,
# #     LiveTranscriptionEvents,
# #     LiveOptions,
# # )
# # import pyaudio

# # # Audio Configuration
# # FORMAT = pyaudio.paInt16
# # CHANNELS = 1
# # RATE = 16000
# # CHUNK = 1024


# # async def main():
# #     try:
# #         api_key = os.getenv("DEEPGRAM_API_KEY")
# #         if not api_key:
# #             print("Missing DEEPGRAM_API_KEY.")
# #             print('PowerShell: $env:DEEPGRAM_API_KEY = "your_api_key"')
# #             return

# #         client = DeepgramClient(api_key=api_key)
# #         dg_connection = client.listen.asyncwebsocket.v("1")
# #         tracker = ScoreCallTracker()

# #         def on_verified_call(call):
# #             # Integration point for the rest of the application.
# #             #
# #             # `call` is sent here only after the player says yes/confirm/correct/right.
# #             # Score calls are normalized strings such as "30-40" or "AD-40";
# #             # commands such as "fault", "let", and "ace" are lowercase strings.
# #             # Replace this print with the backend operation, for example:
# #             #   update_match_score(match_id, call)
# #             #   await api_client.post("/matches/{match_id}/calls", {"call": call})
# #             # Keep this callback fast, or queue the update for asynchronous work.
# #             print(f"BACKEND {call}")

# #         async def on_message(self, result, **kwargs):
# #             transcript = result.channel.alternatives[0].transcript.strip()
# #             if not transcript:
# #                 return

# #             if result.is_final:
# #                 print(f"CALL  {transcript}")
# #             else:
# #                 print(f"...    {transcript}", end="\r")

# #         async def on_error(self, error, **kwargs):
# #             print(f"\nDeepgram error: {error}")

# #         dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)
# #         dg_connection.on(LiveTranscriptionEvents.Error, on_error)

# #         options = LiveOptions(
# #             model="nova-3",
# #             language="en",
# #             smart_format=True,
# #             encoding="linear16",
# #             channels=CHANNELS,
# #             sample_rate=RATE,
# #             interim_results=True,
# #         )

# #         print("Connecting to Deepgram...")
# #         if await dg_connection.start(options) is False:
# #             print("Failed to connect to Deepgram.")
# #             return

# #         p = pyaudio.PyAudio()
# #         stream = p.open(
# #             format=FORMAT,
# #             channels=CHANNELS,
# #             rate=RATE,
# #             input=True,
# #             frames_per_buffer=CHUNK,
# #         )

# #         print("Microphone is live. Say a tennis score, Fault, or Correction.")
# #         print("Each call must be verified with Yes/Confirm or rejected with No/Repeat.")
# #         print("Press Ctrl+C to stop.\n")

# #         try:
# #             while True:
# #                 data = stream.read(CHUNK, exception_on_overflow=False)
# #                 enhanced_data = enhance_audio(data)
# #                 if is_speech(enhanced_data):
# #                     await dg_connection.send(enhanced_data)
# #                 await asyncio.sleep(0.005)
# #         except KeyboardInterrupt:
# #             print("\nStopping stream...")
# #         finally:
# #             # Clean up audio and socket connections
# #             stream.stop_stream()
# #             stream.close()
# #             p.terminate()
# #             await dg_connection.finish()
# #             print("Disconnected.")

# #     except Exception as error:
# #         print(f"Could not start voice recognition: {error}")

# # if __name__ == "__main__":
# #     asyncio.run(main())


# import asyncio
# import os
# import re

# from deepgram import (
#     DeepgramClient,
#     LiveTranscriptionEvents,
#     LiveOptions,
# )
# import pyaudio

# # Audio Configuration
# FORMAT = pyaudio.paInt16
# CHANNELS = 1
# RATE = 16000
# CHUNK = 1024
# POINT_VALUES = {
#     "love": "0",
#     "zero": "0",
#     "fifteen": "15",
#     "thirty": "30",
#     "forty": "40",
#     "fourty": "40",
#     "advantage": "AD",
#     "ad": "AD",
# }


# def normalize_score_call(transcript):
#     """Convert common speech-to-text score variants to a hyphenated score."""
#     text = transcript.lower().replace("-", " ")
#     for word, value in POINT_VALUES.items():
#         text = re.sub(rf"\b{word}\b", f" {value} ", text)

#     values = re.findall(r"(?<!\d)(?:0|15|30|40|ad)(?!\d)", text)
#     if len(values) < 2:
#         for compact_number in re.findall(r"\d+", text):
#             if re.fullmatch(r"(?:40|30|15|0)+", compact_number):
#                 values.extend(re.findall(r"40|30|15|0", compact_number))

#     if len(values) >= 2:
#         return f"{values[0].upper()}-{values[1].upper()}"
#     return transcript


# def print_call(transcript, source="VOICE"):
#     print(f"{source:<6} {normalize_score_call(transcript)}")


# async def main():
#     try:
#         api_key = "1ba157bf5683dd8b441996773275451e83f3b168"
#         if not api_key:
#             print("Missing DEEPGRAM_API_KEY.")
#             print('PowerShell: $env:DEEPGRAM_API_KEY = "your_api_key"')
#             return

#         client = DeepgramClient(api_key=api_key)
#         dg_connection = client.listen.asyncwebsocket.v("1")

#         async def on_message(self, result, **kwargs):
#             transcript = result.channel.alternatives[0].transcript.strip()
#             if not transcript:
#                 return

#             if result.is_final:
#                 print_call(transcript)
#             else:
#                 print(f"...    {transcript}", end="\r")

#         async def on_error(self, error, **kwargs):
#             print(f"\nDeepgram error: {error}")

#         dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)
#         dg_connection.on(LiveTranscriptionEvents.Error, on_error)

#         options = LiveOptions(
#             model="nova-3",
#             language="en",
#             smart_format=True,
#             encoding="linear16",
#             channels=CHANNELS,
#             sample_rate=RATE,
#             interim_results=True,
#             keyterm=[
#                 "zero",
#                 "fifteen",
#                 "thirty",
#                 "forty",
#                 "fault",
#                 "correction",
#                 "advantage",
#             ],
#         )

#         print("Connecting to Deepgram...")
#         if await dg_connection.start(options) is False:
#             print("Failed to connect to Deepgram.")
#             return

#         p = pyaudio.PyAudio()
#         stream = p.open(
#             format=FORMAT,
#             channels=CHANNELS,
#             rate=RATE,
#             input=True,
#             frames_per_buffer=CHUNK,
#         )

#         print("Microphone is live. Say a tennis score, Fault, or Correction.")
#         print("Press Ctrl+C to stop.\n")

#         try:
#             while True:
#                 data = stream.read(CHUNK, exception_on_overflow=False)
#                 await dg_connection.send(data)
#                 await asyncio.sleep(0.005)
#         except KeyboardInterrupt:
#             print("\nStopping stream...")
#         finally:
#             # Clean up audio and socket connections
#             stream.stop_stream()
#             stream.close()
#             p.terminate()
#             await dg_connection.finish()
#             print("Disconnected.")

#     except Exception as error:
#         print(f"Could not start voice recognition: {error}")

# if __name__ == "__main__":
#     asyncio.run(main())
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