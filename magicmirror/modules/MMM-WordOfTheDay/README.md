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

`words.json` holds 529 words in two tiers — 240 everyday words and 289 harder
ones (see **Difficulty tiers** below). Each day draws ten at random from the
words the current **cycle** has not shown yet, so no word repeats until every
word has had a turn. With the default settings a cycle is **53 days**; when it
runs out, the next one starts by itself and the list goes round again.

A word also has to **rest for half a cycle** (26 days) after it is shown. That
is what stops a word from closing one cycle and opening the next. The old draw
shuffled each pass on its own, so that happened often — over three years about
one return in eight came within two weeks, some the very next day. Now the
shortest possible return is 26 days and the typical one is a full cycle.

The draw runs in `node_helper.js` (logic in `draw.js`) and is **remembered**, in
`state/history.json` (see **Tracking what has been shown**). So:

- Restarting the mirror mid-day keeps the same ten, in the same order.
- Days the mirror is switched off cost nothing. The words it would have shown
  are still waiting for their turn.
- Words added to `words.json` join the current cycle straight away. Removed ones
  are simply never drawn again. `words.json` is re-read every morning, so no
  restart is needed.
- If `wordsPerDay` does not divide the list evenly, the last day of a cycle
  takes the cycle's remaining words and tops up from the start of the next. No
  word repeats inside a cycle and every day is still ten distinct words.

The day is the local calendar date (moved back by `dayRolloverHour`), so it does
not slide by an hour across a daylight-saving change.

## Tracking what has been shown

`state/history.json` is written on the mirror and never committed (it's
gitignored). It holds:

| Field       | What it is                                                     |
| ----------- | -------------------------------------------------------------- |
| `cycle`     | Which pass through the list this is (1, 2, 3, …).              |
| `used`      | Every word this cycle has shown so far.                        |
| `lastShown` | The date each word was last on screen; drives the rest period. |
| `today`     | Today's ten, so a restart shows the same ones.                 |
| `history`   | One line per day: date, cycle and the ten words (≈ 3 years).   |

Words are identified as `somali|english`, so correcting an entry gives the
corrected version a fresh turn.

For a readable summary on the Pi (cycle, words shown and left, today's ten,
the last seven days):

```bash
curl -s localhost:8080/api/wotd/status | python3 -m json.tool
```

The mirror's log gets one line per day, e.g.
`[MMM-WordOfTheDay] 2026-11-28: cycle 1, 270/529 shown, 259 to go`.

To start over from a fresh cycle, stop the mirror, delete `state/history.json`
and start it again. A damaged file is moved aside (`history.json.corrupt-…`) and
replaced automatically rather than blanking the bar.

**First run.** With no history yet, the helper replays what the old date-based
draw showed recently and counts those words as used, so the switch itself
doesn't bring back words from the last few weeks.

## Configuration

| Option                | Default                               | Description                                                                                        |
| --------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `wordsPerDay`         | `10`                                  | Words drawn per day. Fewer words means more days per cycle.                                        |
| `levels`              | `["core", "advanced"]`                | Difficulty tiers to draw from. `["advanced"]` gives only the harder 289. See **Difficulty tiers**. |
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

`cat` must be a key in the `categories` object at the top of the file. New
words join the current cycle at the next day's draw, and the cycle length
(`ceil(total / wordsPerDay)` days) follows automatically. Nothing else needs
updating.

Give new entries an `"added": "YYYY-MM-DD"` date. Apart from recording when a
word arrived, it tells the first-run migration which entries the old date-based
draw never had.

## Difficulty tiers

Every entry has a `level`. **A missing `level` means `core`**, which is why the
original 240 entries carry no such field — only the harder tier is tagged:

```json
{ "so": "murti", "en": "wisdom", "pron": "mur-ti", "cat": "maskax",
  "exSo": "Murti iyo aqoon.", "exEn": "Wisdom and knowledge.",
  "level": "advanced", "review": true }
```

`levels` in the config picks which tiers are in play. A value matching nothing
falls back to the whole list rather than leaving the bar empty, so a typo cannot
blank the display. The cycle length follows the *active* pool, so
`levels: ["advanced"]` means 289 words and a 29-day cycle.

The advanced tier came in two batches: 60 words on 2026-10-07, and 229 more on
2026-11-28 (those carry `"added": "2026-11-28"`). The second batch leans on
vocabulary a learner meets later: abstract nouns (`ujeeddo` purpose, `qanacsanaan`
contentment), civic words (`doorasho` election, `musuqmaasuq` corruption),
literature (`suugaan`, `maanso`, `tiraab`), the four Somali seasons (`jiilaal`,
`gu'`, `xagaa`, `dayr`), the extended family (`adeer`, `abti`, `eedo`, `habaryar`),
and less common animals, landforms and body words.

### `review: true`

Every advanced entry was drafted rather than verified. `review: true` marks
them so they can be audited or removed without disturbing anything else:

```bash
# list everything still awaiting a native check
python -c "import json;d=json.load(open('words.json',encoding='utf-8'));[print(w['so'],'|',w['en'],'|',w['pron'],'|',w['exSo']) for w in d['words'] if w.get('review')]"
```

Drop the flag once an entry has been checked. The glosses, the respellings and
the example sentences are all places to look closely — particularly the
definite-article suffixes in the examples (`shaqo` → `shaqada`, `su'aal` →
`su'aasha`), which are easy to get wrong.

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
