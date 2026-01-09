import sounddevice as sd
import numpy as np

duration = 5  # seconds
fs = 44100

print("Recording...")
recording = sd.rec(int(duration * fs), samplerate=fs, channels=1)
sd.wait()
print("Recording complete")

# Save to test.wav
from scipy.io.wavfile import write
write("test.wav", fs, recording)
print("Saved to test.wav")
