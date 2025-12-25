# MMM-QuranEmbed

This is a module for the [MagicMirror²](https://github.com/MichMich/MagicMirror/) to display Quran content in your smart mirror.

## Features

- Display Quran content in two modes:
  - **iframe mode**: Embeds Quran.com in your MagicMirror
  - **API mode**: Directly displays Quran content using the Quran Foundation API
- Control via API to show specific surahs
- Navigate through the Quran seamlessly
- Show translations alongside Arabic text

## Installation

1. Navigate to your MagicMirror's modules folder:
```bash
cd ~/MagicMirror/modules/
```

2. Clone this repository:
```bash
git clone https://github.com/yourusername/MMM-QuranEmbed.git
```

3. Install dependencies:
```bash
cd MMM-QuranEmbed
npm install
```

4. Add the module to your `config/config.js` file:
```javascript
modules: [
    {
        module: "MMM-QuranEmbed",
        position: "top_center", // This can be any of the available positions
        config: {
            height: "600px",
            width: "100%",
            initialUrl: "https://quran.com", // Default URL when no surah is specified
            showControls: true,
            useAPI: true,               // Set to true to use Quran Foundation API
            clientId: "YOUR_CLIENT_ID", // Required for API mode
            clientSecret: "YOUR_CLIENT_SECRET", // Required for API mode
            displayMode: "iframe",      // 'iframe' or 'api'
            chapterId: 1,               // Default surah/chapter to show (Al-Fatiha)
            translation: 131,           // Default translation ID (131 = Sahih International)
            showTranslation: true       // Whether to show translation
        }
    }
]

## Configuration Options

| Option           | Description                                         | Default            |
| ---------------- | --------------------------------------------------- | ------------------ |
| `height`         | Height of the Quran display                         | `"600px"`          |
| `width`          | Width of the Quran display                          | `"100%"`           |
| `initialUrl`     | Default URL for iframe mode                        | `"https://quran.com"` |
| `showControls`   | Whether to show scrollbars and controls             | `true`             |
| `useAPI`         | Whether to use the Quran Foundation API             | `false`            |
| `clientId`       | Your Quran Foundation API client ID                 | `""`               |
| `clientSecret`   | Your Quran Foundation API client secret            | `""`               |
| `displayMode`    | Display mode: 'iframe' or 'api'                    | `"iframe"`         |
| `chapterId`      | Default chapter/surah ID to show                   | `1` (Al-Fatiha)    |
| `verseRange`     | Optional verse range, e.g. '1-7'                   | `null`             |
| `translation`    | Translation ID                                     | `131` (Sahih International) |
| `showTranslation` | Whether to show translation                        | `true`             |

## Getting Quran Foundation API Access

To use the API mode, you need to obtain API credentials from the Quran Foundation:

1. Visit [Quran Foundation API](https://quran.foundation) and request access
2. When you receive your Client ID and Client Secret, update your module configuration

## API Endpoints

The module exposes an API endpoint that can be called to change the displayed surah:

```
POST /api/module/MMM-QuranEmbed/QURAN_EMBED
```

With body:
```json
{
    "url": "https://quran.com/1"
}
```

This will update the module to show Surah Al-Fatiha.

## Integration with Voice Assistants

You can integrate this with Home Assistant, Siri, Google Assistant, or any other voice assistant that can make HTTP requests. For example, to open Surah Yasin (36), you would make a request to:

```
POST /api/module/MMM-QuranEmbed/QURAN_EMBED
```

With body:
```json
{
    "url": "https://quran.com/36"
}
```

## Module Notifications

You can also control the module through notifications from other modules:

```javascript
this.sendNotification("QURAN_SHOW_CHAPTER", {
    chapterId: 36,            // Surah Yasin
    verseRange: "1-83",       // Optional verse range
    translation: 131          // Optional translation ID
});
```

## Future Plans

- Add more customization options
- Support for additional translations
- Bookmarking system
- Audio recitations

## License

MIT Licensed.
