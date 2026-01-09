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
| Compliments | ✅ Working | Random greetings |

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

### Autostart (MagicMirror + Voice Listener with `venv`)

Use this when you want the Pi to boot straight into the MagicMirror server and the Quran voice listener (inside its Python virtual environment):

```bash
# 1. Create combined startup script (Pi)
cat > ~/start_mirror_with_venv.sh << 'EOF'
#!/bin/bash

# Start MagicMirror server
cd ~/MagicMirror-Pi5/magicmirror
npm run server &

# Start voice listener (activate venv first)
cd ~/MagicMirror-Pi5/magicmirror/modules/MMM-QuranDisplay
source venv/bin/activate
python3 voice_listener_ollama.py
EOF

# 2. Make it executable
chmod +x ~/start_mirror_with_venv.sh

# 3. Add to desktop autostart
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/magicmirror.desktop << 'EOF'
[Desktop Entry]
Type=Application
Name=MagicMirror with Voice Listener (VENV)
Exec=/bin/bash -c "~/start_mirror_with_venv.sh"
X-GNOME-Autostart-enabled=true
EOF

# 4. (Optional) Test immediately without rebooting
~/start_mirror_with_venv.sh &
```

**Disable later:** `rm ~/.config/autostart/magicmirror.desktop`  
**Modify startup logic:** `nano ~/start_mirror_with_venv.sh`

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
