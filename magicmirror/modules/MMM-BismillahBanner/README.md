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
    imageUrl: "assets/bismillah.svg",
    imageWidthPx: 380,
    imageBackgroundColor: "#000000",
    imagePaddingPx: 0,
    imageBorderRadiusPx: 0,
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

## Image source

`imageUrl` is resolved **relative to this module folder** unless it starts with
`http://`, `https://`, `//` or `/`. The default (`assets/bismillah.svg`,
[Bismillah_Calligraphy6.svg](https://commons.wikimedia.org/wiki/File:Bismillah_Calligraphy6.svg)
from Wikimedia Commons) is vendored into the repo on purpose: the banner used to
point straight at Wikimedia, and any hiccup fetching it at page load dropped the
module into the plain-text fallback until the next browser restart.

If the image does fail anyway, `imageRetryCount` (default 4) retries with a
growing delay (`imageRetryDelayMs`, default 3000ms) before falling back to text.
