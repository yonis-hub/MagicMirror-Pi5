# MMM-BismillahBanner

Simple static top-bar banner to display:

`بِسْمِ ٱللهِ ٱلرَّحْمٰنِ ٱلرَّحِيْمِ`

## Example config (calligraphy image, green on black)

```js
{
  module: "MMM-BismillahBanner",
  position: "top_bar",
  config: {
    renderMode: "image",
    imageUrl: "https://www.clipartmax.com/png/middle/269-2695997_free-download-of-bismillah-icon-clipart-image-bismillahir-rahmanir-rahim-in-arabic.png",
    imageWidthPx: 380,
    imageBackgroundColor: "#000000",
    textColor: "#7be38d",
    stylePreset: "classical-naskh",
    fontScale: 1.25,
    showLigature: false,
    showTransliteration: false
  }
}
```

## Style presets

- `classical-naskh` (default)
- `thuluth`
- `compact`

## Render modes

- `image` (default): shows calligraphy image and tints it green with CSS filter
- `text`: renders Arabic text using the selected style preset
