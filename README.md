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

## 🔜 Future Enhancements: "Verse Chainer"

**Next session goal:** Voice-controlled Quran recitation with verse-by-verse synchronization.

### Components Needed
- [ ] **Ollama** - Local AI for voice command interpretation
- [ ] **MMM-GoogleAssistant** - Voice control module
- [ ] **MMM-QuranDisplay** - New minimalist verse display module
- [ ] **quran_chainer.py** - Python script for verse-by-verse playback
- [ ] **mpv** - Audio player for recitation

### Architecture
1. Voice command: "Play Surah Fatiha"
2. Ollama interprets → Surah number (1)
3. Python fetches from Al Quran Cloud API
4. Loop: Display verse → Play audio → Wait → Next verse

### API Endpoints
- **Quran Data:** `http://api.alquran.cloud/v1/surah/{surah}/editions/ar.alafasy,en.asad`
- **Audio CDN:** Included in API response (`ayahs[].audio`)

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

---

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

**Next Session:**
- Implement "Verse Chainer" for voice-controlled Quran recitation
- Install Ollama on Pi
- Create MMM-QuranDisplay module
- Set up Google Assistant integration
