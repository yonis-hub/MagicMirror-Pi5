# MMM-QuranDisplay

Compact Quran playback display for MagicMirror.

## Runtime Flow

- `MMM-QuranDisplay.js` renders the surah/ayah status UI.
- `node_helper.js` starts `quran_chainer.py`.
- `quran_chainer.py` plays recitation audio and pushes verse/status updates to MagicMirror.
- `voice_listener_ollama.py` is optional and can be run as a separate process for wake-word and voice commands.

## Local Quran Audio (Primary Path)

Playback uses local files in `quran_data` first:

```
<repo>/quran_data/<surah>/<ayah>.json
<repo>/quran_data/<surah>/<ayah>.mp3
<repo>/quran_data/surah_index.json
```

If local data is missing for a surah/ayah, `quran_chainer.py` falls back to API/network sources.
Surah names are loaded from local `surah_index.json` first. Set `QURAN_ALLOW_METADATA_API=1` only if you want network metadata fallback.

The `<ayah>.json` files carry the Arabic text and translation shown on screen, whichever reciter is playing, so keep them even when no per-ayah audio is installed.

## Reciters

There are two reciters, listed in `reciters.json`. Each one is a single MP3 per surah, gitignored and copied to the Pi by hand:

| Key | Name | Audio |
| --- | --- | --- |
| `sudais` (default, "first") | Sheikh Abdur-Rahman As-Sudais | `quran_data/_reciters/Abdur-Rahman As-Sudais/001.mp3` … `114.mp3` |
| `noreen-sedeeq` ("second") | Sheikha Noreen Mohammad Siddiq | `quran_data/_reciters/noreen-sedeeq/001.mp3` … `114.mp3` |

The Sudais set came from Quran Central (`https://podcasts.qurancentral.com/abdur-rahman-as-sudais/NNN.mp3`).

Switching is by voice:

- **"Switch reciter"** (or just "switch") flips to the other reciter.
- **"Switch to Sudais"** or **"Switch to Noreen"** picks one by name. A bare "Sudais" or "Noreen" works too.

After a switch the mirror shows the new reciter's name full-size for a few seconds (`reciterAnnounceMs`, 6000 by default). The idle screen keeps a small "Qaariga — name" line (`showReciterWhenIdle`). If a surah was playing, it starts again from the beginning in the new voice. The choice is saved in `reciters.json` as `current`, so it survives a restart.

## Installation

```bash
cd ~/MM-Pi5/magicmirror/modules/MMM-QuranDisplay
pip3 install requests faster-whisper numpy sounddevice
sudo apt install mpv
```

For voice features with semantic search:

```bash
pip3 install sentence-transformers psutil
```

## MagicMirror Config

```js
{
  module: "MMM-QuranDisplay",
  position: "middle_center",
  config: {
    showVerseNumber: true,
    showSurahName: true,
    showBismillah: true,
    hideBismillahForSurah9: true,
    bismillahText: "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ",
    bismillahRenderMode: "image", // "image" or "text"
    bismillahImageUrl: "assets/bismillah.svg",
    bismillahImageWidthPx: 250,
    arabicFontFamily: "\"Aref Ruqaa Ink\", \"Aref Ruqaa\", \"Scheherazade New\", Amiri, \"Traditional Arabic\", serif",
    arabicFontWeight: "700",
    showAdhkarNowPlaying: true, // show currently playing adhkar title block
    showAdhanIndicator: true,
    adhanIndicatorLabel: "Adhan",
    adhanIndicatorIcon: "https://cdn-icons-png.flaticon.com/512/2918/2918161.png",
    showReciterWhenIdle: true, // "Qaariga — name" line under the wake-word prompt
    reciterAnnounceMs: 6000, // how long the name stays up after "switch reciter"
    ayahLabelFormat: "compact", // "ayah" or "compact"
    animationSpeed: 500,
    fontSize: {
      info: "1.1em"
    }
  }
}
```

## Commands

Manual playback:

```bash
python3 quran_chainer.py --surah 1
python3 quran_chainer.py --surah yasin --start-verse 10
```

Voice listener:

```bash
./start_listener.sh
```

## Data Utilities

- `quran_harvester.py`: downloads/repairs complete Quran JSON + MP3 into `quran_data`.
- `generate_embeddings.py`: builds local verse embeddings for topic search.

## Adhkar Status Integration

If `MMM-MyPrayerTimes` publishes `ADHKAR_STATUS`, this module shows the active adhkar period, title, and track number while adhkar audio is playing.

## Always-On Deploy

- Use `deploy/systemd/README.md` at repo root for production service install on Raspberry Pi.
