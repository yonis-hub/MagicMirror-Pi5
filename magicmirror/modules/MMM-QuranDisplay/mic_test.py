import sounddevice as sd
import soundfile as sf
import numpy as np

# Record audio
duration = 5  # seconds
fs = 44100  # sample rate
print(f"Recording for {duration} seconds...")
recording = sd.rec(int(duration * fs), samplerate=fs, channels=1)
sd.wait()
print("Recording complete")

# Save to file
filename = "mic_test.wav"
sf.write(filename, recording, fs)
print(f"Saved recording to {filename}")

# Play back recording
print("Playing back recording...")
data, fs = sf.read(filename)
sd.play(data, fs)
sd.wait()
print("Playback complete")
