# MMM-Greeting

The bilingual welcome line at the top of the bottom bar, above
[MMM-WordOfTheDay](../MMM-WordOfTheDay). Picks a greeting for the time of day
and, when MMM-FaceIdentity recognises whoever is at the mirror, greets them by
name. Replaces the greeting half of the old `compliments` module.

```
              Subax wanaagsan, Hodan   GOOD MORNING, HODAN
                            ──────◆──────
```

## The camera is usually off

The face camera is off more often than not, so the no-name line is the normal
case, not a fallback. Every greeting is written to read properly without a name:
`{name}` is dropped together with the comma that introduced it, so
`"Subax wanaagsan, {name}"` becomes `"Subax wanaagsan"` — not
`"Subax wanaagsan,"`.

That means you can write one line and get both readings. Only add a line to
`identityGreetings` when it should _only_ appear for that person.

## Parts of the day

| Part        | Default hours |
| ----------- | ------------- |
| `morning`   | 05:00 – 11:59 |
| `afternoon` | 12:00 – 16:59 |
| `evening`   | 17:00 – 20:59 |
| `night`     | 21:00 – 04:59 |

Adjust with `morningStartTime`, `afternoonStartTime`, `eveningStartTime` and
`nightStartTime`. The old compliments module had no separate `night` bucket —
anything after 18:00 was "evening".

## Configuration

| Option                 | Default                | Description                                                                                             |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `updateInterval`       | `60000`                | How long a greeting holds, in ms.                                                                       |
| `fadeSpeed`            | `2000`                 | Cross-fade between greetings, in ms.                                                                    |
| `random`               | `true`                 | Pick at random (never the same line twice running) rather than in order.                                |
| `showEnglish`          | `true`                 | The small uppercase English reading beside the Somali.                                                  |
| `showRule`             | `true`                 | The hairline-and-diamond ornament that ties this to the word of the day.                                |
| `identityDisplayNames` | `{}`                   | Map of identity key → the name to show, e.g. `{ yonis: "Yonis" }`.                                      |
| `identityGreetings`    | `{}`                   | Per-person lines, same shape as `greetings`. Offered _alongside_ the generic ones, not instead of them. |
| `identityNotification` | `FACE_IDENTITY_UPDATE` | Notification MMM-FaceIdentity broadcasts.                                                               |
| `greetings`            | see the module         | The generic lines.                                                                                      |

## Writing greetings

Each entry is a `{ so, en }` pair:

```
greetings: {
  morning: [
    { so: "Subax wanaagsan, {name}", en: "Good morning, {name}" },
    { so: "Subaxdu waa fursad cusub", en: "The morning is a fresh chance" }
  ]
}
```

Any key that is not one of `morning` / `afternoon` / `evening` / `night` /
`anytime` is treated as a regular expression matched against today's
`YYYY-MM-DD` — the same trick the compliments module used. `"....-01-01"` fires
every New Year's Day.

If a part of the day has no lines at all, `anytime` is used instead.

## The font

The script face is **vendored** in `assets/` as two woff2 subsets (65KB total,
Dancing Script, SIL Open Font License) rather than `@import`ed from Google Fonts
at runtime. The compliments module imported it over the network and was rendering
in a serif fallback on the Pi — the kiosk runs for weeks and must not depend on a
font request succeeding. This is the same reason MMM-BismillahBanner vendors its
calligraphy locally.
