# MMM-FaceIdentity

Local-only webcam identity for MagicMirror compliments.

## Security Model

- Opens the webcam only from a local Python worker on the Pi.
- Does not expose any live stream, snapshot endpoint, or HTTP camera route.
- Stores only local face encodings in `data/encodings.json`.
- Raw webcam images are not saved during normal recognition.
- Enrollment stores embeddings only, not frames.

## What It Publishes

This module only sends a local MagicMirror notification:

- `FACE_IDENTITY_UPDATE`

Possible identities:

- `hyonis`
- `wife`
- `both`
- `unknown`

## Install Dependencies on Pi

```bash
cd ~/MagicMirror-Pi5/magicmirror/modules/MMM-FaceIdentity
sudo apt install python3-opencv python3-pip cmake libatlas-base-dev
pip3 install face_recognition numpy
```

## Enroll Face Profiles

No raw webcam images are stored. Each run captures live samples and saves only encodings.

```bash
cd ~/MagicMirror-Pi5/magicmirror/modules/MMM-FaceIdentity
python3 enroll_face.py --label hyonis --samples 6
python3 enroll_face.py --label wife --samples 6
```

If you want to replace a profile instead of appending:

```bash
python3 enroll_face.py --label hyonis --samples 6 --replace
```

## Config Example

```js
{
  module: "MMM-FaceIdentity",
  position: "fullscreen_below",
  classes: "hidden",
  config: {
    cameraIndex: 0,
    scanIntervalMs: 2500,
    requiredMatches: 2,
    recallHoldMs: 25000,
    unknownHoldMs: 8000,
    matchThreshold: 0.46,
    frameWidth: 320,
    frameHeight: 240,
    labels: ["hyonis", "wife"],
    dataFile: "data/encodings.json",
    pythonBinary: "python3"
  }
}
```

## Notes

- Keep the webcam private by leaving MagicMirror bound to localhost or your existing whitelist.
- Use steady lighting for better recognition.
- If neither face is confidently recognized, compliments stay in generic mode.
