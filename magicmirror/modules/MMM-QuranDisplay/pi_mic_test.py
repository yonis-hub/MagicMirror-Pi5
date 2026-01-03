import sounddevice as sd
import soundfile as sf
import numpy as np

# Use PulseAudio device
device = 'pulse'

# Record audio
duration = 5  # seconds
fs = 44100  # sample rate
print(f"Recording for {duration} seconds using device '{device}'...")
recording = sd.rec(int(duration * fs), samplerate=fs, channels=1, device=device)
sd.wait()
print("Recording complete")

# Save to file
filename = "pi_mic_test.wav"
sf.write(filename, recording, fs)
print(f"Saved recording to {filename}")

# Play back recording
print("Playing back recording...")
data, fs = sf.read(filename)
sd.play(data, fs, device=device)
sd.wait()
print("Playback complete")
