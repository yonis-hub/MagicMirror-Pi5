# Magic Mirror Pi 5 - Islamic Smart Display

A MagicMirror² deployment for Raspberry Pi 5 featuring Islamic modules including Prayer Times with Hijri calendar, Quran verse display, and sports scoreboards.

**GitHub Repository:** https://github.com/yonis-hub/MagicMirror-Pi5.git

---

## ✅ Current Status: DEPLOYED TO PI 5

The MagicMirror is fully operational on Raspberry Pi 5 with the following modules:

| Module | Status | Description |
|--------|--------|-------------|
| MMM-MyPrayerTimes | ✅ Working | Prayer times with Hijri date (Toronto/ISNA) |
| MMM-QuranEmbed | ✅ Working | Displays Quran verses with Arabic + English |
| MMM-MyScoreboard | ✅ Working | NBA live scores |
| Calendar | ✅ Working | US + Islamic holidays |
| Weather | ✅ Working | London, Ontario forecast |
| Clock | ✅ Working | Date and time display |
| MMM-WebSpeechTTS | ✅ Working | Text-to-speech capability |
| Newsfeed | ✅ Working | BBC World + TechCrunch |
| MMM-Greeting | ✅ Working | Bilingual Somali/English greeting, by name when a face is recognised |
| MMM-WordOfTheDay | ✅ Working | 10 Af-Soomaali / English words a day, rotating; 240-word list |

---

## 🖥️ Raspberry Pi 5 Setup

### Prerequisites on Pi
- **Node.js v20+** (required for `fetch` API)
- **npm**

### Installation Commands (on Pi)

```bash
# 1. Install Node.js v20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Clone the repository
cd ~
git clone https://github.com/yonis-hub/MagicMirror-Pi5.git
cd MagicMirror-Pi5/magicmirror

# 3. Install MagicMirror dependencies
npm install

# 4. Install module dependencies
cd modules/MMM-MyPrayerTimes && npm install && cd ..
cd MMM-MyScoreboard && npm install && cd ../..

# 5. Start MagicMirror
npm run server
```

### Access the Mirror
- **Local:** http://localhost:8080
- **Network:** http://<pi-ip>:8080

### Useful Commands

```bash
# Kill stuck process on port 8080
sudo fuser -k 8080/tcp

# Check Node version (must be 18+)
node -v

# Pull latest changes
cd ~/MagicMirror-Pi5 && git pull
```

---

## 📁 Project Structure

```
Magic_Mirror_v1/
├── magicmirror/
│   ├── config/
│   │   └── config.js          # Main configuration
│   └── modules/
│       ├── MMM-MyPrayerTimes/ # Prayer times + Hijri calendar
│       ├── MMM-QuranEmbed/    # Quran verse display
│       ├── MMM-MyScoreboard/  # Sports scores
│       └── MMM-WebSpeechTTS/  # Text-to-speech
└── README.md
```

---

## ⚙️ Configuration

Key settings in `magicmirror/config/config.js`:

### Prayer Times (Toronto, ISNA Method)
```javascript
{
    module: "MMM-MyPrayerTimes",
    position: "top_left",
    config: {
        mptLat: 43.6532,      // Toronto latitude
        mptLon: -79.3832,     // Toronto longitude
        mptMethod: 2,         // ISNA calculation
        showOnlyNext: true    // Show next prayer only
    }
}
```

### Weather (London, Ontario)
```javascript
{
    module: "weather",
    config: {
        locationID: "6058560", // London, ON
        apiKey: "YOUR_API_KEY"
    }
}
```

---

## 🎙️ Verse Chainer - Voice-Controlled Quran Recitation

Synchronized verse-by-verse Quran playback with audio and display.

### Components
- [x] **MMM-QuranDisplay** - Minimalist verse display module
- [x] **quran_chainer.py** - Python script for verse-by-verse playback
- [ ] **Ollama** - Local AI for voice command interpretation (optional)
- [ ] **mpv** - Audio player for recitation

### Pi Setup Commands

```bash
# 1. Install mpv audio player
sudo apt install mpv -y

# 2. Install Python requests library
pip3 install requests

# 3. (Optional) Install Ollama for voice command AI
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2:1b  # Lightweight model for Pi

# 4. Pull latest changes
cd ~/MagicMirror-Pi5 && git pull
cd magicmirror && npm run server
```

### Usage

```bash
# Play Surah Al-Fatiha
cd ~/MagicMirror-Pi5/magicmirror/modules/MMM-QuranDisplay
python3 quran_chainer.py --surah 1

# Play Surah Yasin from verse 10
python3 quran_chainer.py --surah yasin --start-verse 10

# Play Surah Rahman
python3 quran_chainer.py --surah rahman
```

### Supported Surahs (by name)
`fatiha`, `baqara`, `imran`, `kahf`, `yasin`, `rahman`, `mulk`, `ikhlas`, `nas`, and all 114 surahs

### Architecture
```
Terminal Command → quran_chainer.py → API Fetch → Display Update + mpv Audio
     ↓                                                ↓
Voice (future) → Ollama → Parse Surah           MMM-QuranDisplay
```

### API Used
- **Al Quran Cloud:** `http://api.alquran.cloud/v1/surah/{surah}/ar.alafasy`
- **Reciter:** Mishary Rashid Al-Afasy

### Autostart (systemd)

The Pi boots straight into the mirror via systemd. There are two scopes, and
mixing them up is the usual source of confusion:

| Unit | Scope | What it runs |
|---|---|---|
| `mm-server.service` | **user** | `node serveronly` (the MagicMirror server) |
| `mm-kiosk.service` | **user** | Chromium in kiosk mode against `localhost:8080` |
| `quran-voice@<user>.service` | **system** | the voice listener, inside its venv |
| `mm-healthcheck@<user>.timer` | **system** | every-minute watchdog over all of the above |

User units need no `sudo` and are managed with `systemctl --user`; system units
need `sudo`. Full install steps are in [AUTOSTART_GUIDE.md](AUTOSTART_GUIDE.md).

```bash
# status
systemctl --user status mm-server mm-kiosk --no-pager
sudo systemctl status quran-voice@$USER --no-pager

# restart after pulling changes
systemctl --user restart mm-server.service
sudo systemctl restart quran-voice@$USER.service
```

> Earlier revisions of this guide told you to autostart the mirror from
> `~/.config/autostart/magicmirror.desktop` or `magicmirror@<user>.service`,
> both of which ran `npm run start` and launched a **second**, Electron-based
> copy of the mirror alongside the kiosk. Both have been removed. If either is
> still on your Pi, retire it:
>
> ```bash
> rm -f ~/.config/autostart/magicmirror.desktop
> sudo systemctl disable --now magicmirror@$USER.service 2>/dev/null || true
> sudo rm -f /etc/systemd/system/magicmirror@.service
> sudo systemctl daemon-reload
> ```

---

## 🛠️ Development (Windows)

### Local Testing
```bash
cd magicmirror
npm run server
# Open http://localhost:8080
```

### Push Changes to Pi
```bash
git add .
git commit -m "Your message"
git push

# Then on Pi:
cd ~/MagicMirror-Pi5 && git pull
sudo fuser -k 8080/tcp
cd magicmirror && npm run server
```

### Commit Message Guidelines
Keep subject lines concise (max 72 characters). Use prefixes like:
- `Add:` — new features/modules
- `Fix:` — bug fixes
- `Update:` — config/script changes
- `Refactor:` — code restructuring
- `Docs:` — documentation only

Example: `Fix: reduce voice listener latency on Pi 5`

--- l

## 📝 Troubleshooting

| Issue | Solution |
|-------|----------|
| `EADDRINUSE: port 8080` | Run `sudo fuser -k 8080/tcp` |
| `fetch is not defined` | Upgrade Node to v18+ |
| Module stuck on "Loading..." | Run `npm install` in module folder |
| Prayer times not loading | Check internet; API: api.aladhan.com |

---

## 📅 Session Log

**December 25, 2025:**
- ✅ Deployed MagicMirror to Raspberry Pi 5
- ✅ Fixed MMM-MyPrayerTimes for Node 16→20 compatibility
- ✅ Added Hijri calendar display
- ✅ Configured Islamic holidays in calendar
- ✅ NBA Scoreboard working
- ✅ All modules operational

**December 26, 2025:**
- ✅ Created MMM-QuranDisplay module (minimalist verse display)
- ✅ Created quran_chainer.py (verse-by-verse playback with audio)
- ✅ Updated config.js with new module
- ✅ Documented Pi setup steps for mpv and Ollama

**Next Session:**
- Deploy to Pi and test audio playback
- (Optional) Set up Ollama for voice command parsing
- (Optional) Integrate Google Assistant for "Play Surah X" commands

---

## Recent Updates

- **Voice Assistant Optimization**: Enhanced for Raspberry Pi 5 with GPU acceleration, quantized models, and resource monitoring.
- **Audio Playback**: Added script to download Quran audio files from Islamic Network CDN.
- **Documentation**: Updated setup instructions and troubleshooting in AUDIO_SETUP.md.
