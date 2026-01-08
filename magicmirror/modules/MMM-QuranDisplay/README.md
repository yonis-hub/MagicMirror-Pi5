# MMM-QuranDisplay

Minimalist Quran verse display module for MagicMirror², designed for the **Verse Chainer** feature.

## Features

- Clean, centered verse display with Arabic + English translation
- Synchronized audio playback via `quran_chainer.py`
- Real-time verse updates via API
- Playing indicator animation
- Voice command integration ready

## Installation

```bash
cd ~/MagicMirror-Pi5/magicmirror/modules/MMM-QuranDisplay
# No npm dependencies needed for the module itself

# Install Python dependencies
pip3 install requests python-mpv

# Install mpv for audio playback
sudo apt install mpv
```

## Configuration

Add to `config/config.js`:

```javascript
{
    module: "MMM-QuranDisplay",
    position: "middle_center",
    config: {
        showArabic: true,
        showTranslation: true,
        showVerseNumber: true,
        showSurahName: true,
        animationSpeed: 500,
        fontSize: {
            arabic: "2.5em",
            translation: "1.2em",
            info: "0.9em"
        }
    }
}
```

## Usage

### Manual playback (from Pi terminal):

```bash
cd ~/MagicMirror-Pi5/magicmirror/modules/MMM-QuranDisplay

# Play Surah Al-Fatiha
python3 quran_chainer.py --surah 1

# Play Surah Yasin starting from verse 10
python3 quran_chainer.py --surah yasin --start-verse 10

# Play with custom MagicMirror URL
python3 quran_chainer.py --surah rahman --mirror-url http://192.168.1.100:8080
```

### Supported Surah Names:
fatiha, baqara, imran, nisa, maida, kahf, yasin, rahman, mulk, nas, etc.

## Data Acquisition (Harvester)

The module now uses the Quran.com API (v4) to download audio and text data. The data is stored locally for offline playback.

### Running the Harvester

```bash
cd ~/MagicMirror-Pi5/magicmirror/modules/MMM-QuranDisplay

# Install required Python packages
pip3 install requests

# Run the harvester script to download specific surahs
python3 quran_harvester.py
```

By default, the script downloads Surahs 1, 36, 112, 113, 114. To download all surahs, modify the script to loop from 1 to 114.

### Data Structure

The data is stored in `/home/pi/quran_data` (or the path you set in the script) with the following structure:

```
/home/pi/quran_data/
    ├── 001/              # Surah Al-Fatiha
    │   ├── 001.mp3       # Audio for Verse 1
    │   ├── 001.json      # Verse data (text and timestamps)
    │   ├── 002.mp3
    │   └── ...
    ├── 036/              # Surah Yasin
    └── ...
```

## Synchronization Engine

The playback system uses the locally stored data for precise synchronization:

1. **Python Control**: Uses `python-mpv` to manage audio playback
2. **Real-time Monitoring**: Checks playback position every 100ms
3. **Word Highlighting**: Sends highlight commands to MagicMirror via WebSockets

## API Endpoints

The module exposes these endpoints for external control:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/quran/verse` | POST | Update displayed verse |
| `/api/quran/status` | POST | Update playback status |
| `/api/quran/clear` | POST | Clear display |

## Architecture

```
Voice Command → Ollama (interpret) → quran_chainer.py → MMM-QuranDisplay
                                          ↓
                                        mpv (audio)
```

## Dependencies

- **Python 3** with `requests` and `python-mpv` libraries
- **mpv** - audio player
- **Ollama** (optional) - for voice command interpretation
