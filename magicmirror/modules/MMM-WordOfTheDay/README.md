# MMM-WordOfTheDay

Bilingual Af-Soomaali / English vocabulary for the bottom bar. Ten words are
drawn for each calendar day and rotate on screen all day; tomorrow draws a fresh
ten. Replaces the `compliments` module, alongside [MMM-Greeting](../MMM-Greeting).

```
                ERAYADA MAANTA · WORDS OF THE DAY

                        basal · onion  [ba-sal]

                   Basal iyo yaanyo. — Onion and tomato.

                 ( 🍛 CUNTADA / FOOD )   ●●●●○○○○○○
```

The title, word and example form one centred column. The category and the
progress dots are asides, so they share a small row at the bottom rather than
crowding the title off centre.

## How the daily draw works

`words.json` holds 240 words. The module shuffles the whole list, walks through
it ten a day, and only reshuffles once every word has had its turn — so a word
comes round again every **24 days**, never twice in the same pass.

The draw is derived from the date alone, so it is stable: restarting the mirror
mid-morning shows the same ten words, in the same order, and a second mirror on
the same network shows the same ten.

The day index is built from the local calendar date rather than a raw
millisecond count, so it does not slide by an hour across a daylight-saving
change.

## Configuration

| Option                | Default                               | Description                                                                                        |
| --------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `wordsPerDay`         | `10`                                  | Words drawn per day. Fewer words means more days per pass.                                         |
| `rotateInterval`      | `30000`                               | How long each word holds the line, in ms. Ten words at 30s loop every 5 minutes.                   |
| `fadeSpeed`           | `1200`                                | Cross-fade between words, in ms.                                                                   |
| `showHeader`          | `true`                                | The `ERAYADA MAANTA` label line.                                                                   |
| `showCategory`        | `true`                                | The category pill, in the footer row.                                                              |
| `showPronunciation`   | `true`                                | The `[ba-sal]` respelling.                                                                         |
| `showExample`         | `true`                                | The example sentence. **Turning this off shortens the bottom bar by ~24px.**                       |
| `showProgress`        | `true`                                | The dots showing how far through today's ten you are, in the footer row.                           |
| `dayRolloverHour`     | `0`                                   | Hour at which a new day starts. Raise it (e.g. `4`) so a late-night viewer still sees today's ten. |
| `labelSo` / `labelEn` | `Erayada Maanta` / `Words of the Day` | Header wording.                                                                                    |
| `wordsFile`           | `words.json`                          | Word list, relative to this folder.                                                                |

## Adding words

Append to the `words` array in `words.json`:

```json
{ "so": "qorrax", "en": "sun", "pron": "qor-rakh", "cat": "cir", "exSo": "Qorraxdu way soo baxday.", "exEn": "The sun has risen." }
```

`cat` must be a key in the `categories` object at the top of the file. Adding
words changes the pass length automatically (`ceil(total / wordsPerDay)` days);
nothing else needs updating.

Somali headwords are in **citation form** — no definite-article suffix. Write
`albaab`, not `albaabka`; `magaalo`, not `magaalada`. Verbs are in the imperative
singular (`cun`, `akhri`, `fur`), which is how Somali dictionaries list them.

The `pron` field is a respelling for English readers, not IPA:

| Written | Sounds like                     | Respelled as               |
| ------- | ------------------------------- | -------------------------- |
| `c`     | a catch deep in the throat      | `'` (`caano` → `'aa-no`)   |
| `x`     | a hard h from the throat        | `kh` (`dayax` → `da-yakh`) |
| `q`     | a k made far back in the throat | `q`                        |
| `dh`    | d with the tongue curled back   | `dh`                       |

## Source of the word list

Seeded from the _English-Somali Dictionary (Top 3500)_
(`admin.opentran.net/pdf/upload/en-so.pdf`). That list is machine-translated and
was not usable as-is — roughly half the entries needed correcting before they
could go on a wall:

- most nouns carried the definite article (`sun → qorraxdu`, `door → albaabka`);
- several had the wrong sense (`close → dhow`, which is "near", not the verb;
  `dates → taariikhaha`, which is calendar dates, not the fruit);
- some were the wrong part of speech (`brave → geesinimo`, which is "bravery").

Pronunciations, example sentences and categories were written by hand. A handful
of everyday words missing from the source (`shimbir`, `mas`, `timir`, `galab`)
were added.

## Height in the bottom bar

The bar grows upward from the bottom of the screen, so the ticker rows below stay
where they are and only the content above moves. This module plus MMM-Greeting
occupies about 124px more than the single `compliments` line did.

Measured at 1920×1080: bottom bar **311px** tall, versus **187px** before. Set
`showExample: false` to get roughly 24px of that back; turning off both
`showCategory` and `showProgress` drops the footer row entirely for another
~26px. Lowering `--wotd-word-size` in `MMM-WordOfTheDay.css` is the other lever.
