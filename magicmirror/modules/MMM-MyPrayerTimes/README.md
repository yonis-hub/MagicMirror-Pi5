# MMM-MyPrayerTimes

Prayer times module for MagicMirror using AlAdhan API, with local adhan/adhkar audio support.

## Key Features

- Daily prayer times by location (`mptLat`, `mptLon`, `mptMethod`)
- Reliable daily timing refresh (URL/date rolls over correctly at midnight)
- Adhan playback with trigger-window protection (`adhanTriggerWindowMinutes`)
- Auto morning/evening adhkar playlists
- Local adhkar assets (`adhkar/`) with manifest metadata (`adhkar_manifest.json`)
- Audio arbitration with Quran module (`QURAN_PAUSE` / `QURAN_RESUME`)

## Install

```bash
cd ~/MagicMirror/modules
git clone https://github.com/htilburgs/MMM-MyPrayerTimes
cd MMM-MyPrayerTimes
npm install
```

## Config Example

```js
{
  module: "MMM-MyPrayerTimes",
  position: "top_left",
  header: "Prayer Times",
  config: {
    mptLat: 42.9849,
    mptLon: -81.2453,
    mptMethod: 2,
    mptOffset: "0,0,0,0,0,0,0,0,0",
    showSunrise: false,
    showSunset: false,
    showMidnight: false,
    showImsak: false,
    show24Clock: false,
    showOnlyNext: true,

    playAdhan: true,
    adhanTriggerWindowMinutes: 1,

    autoPlayAdhkar: true,
    adhkarManifestFile: "adhkar_manifest.json",
    adhkarVolume: 0.85,

    pauseQuranForAdhan: true,
    pauseQuranForAdhkar: true,
    resumeQuranAfterInterruptions: true
  }
}
```

## Adhkar Windows

- Morning: `Fajr -> Sunrise`
- Evening: `Asr -> Sunset`
- Each period auto-plays once per day
- Daily timing freshness is checked before each adhan/adhkar scheduler pass
- Publishes `ADHAN_STATUS` while adhan is playing

While adhkar is playing, this module publishes `ADHKAR_STATUS` notifications. `MMM-QuranDisplay` can render the current adhkar title from that status.

## Local Adhkar Assets

Manifest file: `adhkar_manifest.json`
Local audio folders:

- `adhkar/morning/*.mp3`
- `adhkar/evening/*.mp3`

Sync/repair local files from `sourceUrl` entries:

```bash
cd ~/MagicMirror-Pi5/magicmirror/modules/MMM-MyPrayerTimes
python3 sync_adhkar_assets.py
```

Verify only:

```bash
python3 sync_adhkar_assets.py --verify-only
```

Force redownload:

```bash
python3 sync_adhkar_assets.py --force
```

## Core Options

- `mptLat`: latitude (number)
- `mptLon`: longitude (number)
- `mptMethod`: AlAdhan calculation method
- `mptOffset`: comma-separated minute offsets for timings
- `playAdhan`: enable adhan playback
- `adhanPrayers`: list of prayers that trigger adhan
- `adhanTriggerWindowMinutes`: tolerant trigger window for timer drift
- `autoPlayAdhkar`: enable adhkar autoplay windows
- `adhkarManifestFile`: track metadata file
- `morningAdhkarTracks`: optional inline override array
- `eveningAdhkarTracks`: optional inline override array
- `pauseQuranForAdhan`: send `QURAN_PAUSE` during adhan
- `pauseQuranForAdhkar`: send `QURAN_PAUSE` during adhkar
- `resumeQuranAfterInterruptions`: send `QURAN_RESUME` when done

## License

MIT
