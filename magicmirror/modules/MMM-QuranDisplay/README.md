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
pip3 install requests

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

- **Python 3** with `requests` library
- **mpv** - audio player
- **Ollama** (optional) - for voice command interpretation
