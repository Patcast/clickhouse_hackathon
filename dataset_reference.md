# CLEAR Corpus — Field Reference

What every column in `CLEAR_corpus_final.xlsx` means, plus one fully-annotated record so the team can build intuition for the data. Sample passages live in [dataset_samples.md](dataset_samples.md).

## The dataset in one paragraph

The CLEAR corpus (CommonLit Ease of Readability) contains **4,724 English text excerpts** of **125–205 words each** (mean 171), split almost evenly between **literary** (2,420) and **informational** (2,304) texts. Every excerpt carries source metadata, a content-maturity rating, and a battery of readability scores — including a human-judged easiness score (`BT_easiness`) that is the corpus's headline metric. Sources range from 1800s–1910s public-domain novels (no license listed) to modern CC-licensed children's books (African Storybook, Pratham). **Caveat: it skews hard** — mean Flesch-Kincaid grade is 9.5 and ~1,200 excerpts sit at grade 12+. For our track we filter to roughly Lexile ≤ 900 / FK ≤ 6, which still leaves ~1,000 candidates.

## Fields

### Identity & source

| Field | Meaning | Notes for us |
|---|---|---|
| `ID` | Unique excerpt identifier | Natural primary key for our Postgres `books` table |
| `Author` | Author of the excerpt | Display in app |
| `Title` | Title of the source work | Some titles contain line breaks — clean on import. Many 1910s titles are dry; we may generate kid-friendly display titles |
| `Anthology` | Anthology it was taken from, if any | e.g. "African Storybook Level 4" — useful signal for kid-level content |
| `URL` | Link to the source text | Often blank for old public-domain works |
| `Pub Year` | Year of publication | 1800s–2020. Old year ≈ public domain but also ≈ dated language |
| `Location` | Where in the work the excerpt was cut from (`start` / `mid` / `end`) | `start` excerpts need less context — prefer for standalone challenges |
| `License` | License of the excerpt | ~3,300 blank (public-domain era), 694 CC BY 4.0, rest other CC variants. Blank or CC BY are safe for the demo with attribution |

### Content classification

| Field | Meaning | Notes for us |
|---|---|---|
| `Categ` | `Lit` (literary/fiction) or `Info` (informational) | Our coarse preference axis; roughly 50/50 in the corpus |
| `Sub Cat` | Sub-category for informational texts | Sparse — often empty |
| `Lexile Band` | Lexile reading-score band | Mostly clean numbers (300–1900) but a few messy values like `410L-600L` — normalize on import |
| `MPAA Max` | Content-maturity rating, G through R, movie-style | **Filter to G for the kid app** |
| `MPAA #Max` | The max numeric MPAA rating given by the raters | 1 = G |
| `MPAA# Avg` | Average numeric MPAA rating between the two raters | Use for tie-breaking borderline content |

### The text itself

| Field | Meaning | Notes for us |
|---|---|---|
| `Excerpt` | The full passage text | 125–205 words — this IS the reading content for the app |
| `Google WC` | Word count | For estimating reading time |
| `Sentence Count` | Number of sentences | |
| `Paragraphs` | Number of paragraphs | 1-paragraph excerpts render as a wall of text — consider in UI |

### Readability scores (the interesting part)

Two families: **human-judged** and **formula-based**. The formulas split further into *syntax-driven* and *vocabulary-driven* — that split is what powers our multi-axis pitch.

| Field | Meaning | Driven by | Notes for us |
|---|---|---|---|
| `BT_easiness` | Bradley-Terry easiness score from thousands of pairwise "which is easier?" judgments by teachers. The official "CLEAR score" | Humans | Higher = easier. Roughly −3 (hard) to +2 (easy). The most trustworthy single difficulty number |
| `s.e.` | Standard error of `BT_easiness` | — | Ignore for the hackathon |
| `Flesch-Reading-Ease` | Classic 0–100 readability score | Sentence length + syllables | Higher = easier. 90+ ≈ 5th grade, 60–70 ≈ 8th–9th |
| `Flesch-Kincaid-Grade-Level` | Same formula rescaled to US school grade | Sentence length + syllables (**syntax axis**) | Our main level filter: FK ≤ 6 for the kid subset |
| `Automated Readability Index` | Grade-level estimate from characters/word and words/sentence | Syntax | Sanity check on FK |
| `SMOG Readability` | Grade estimate from polysyllabic word count | Word length | |
| `New Dale-Chall Readability Formula` | Grade estimate from % of words NOT on a list of 3,000 words familiar to 4th graders | **Vocabulary axis** | The key counterpart to FK: high Dale-Chall + low FK = vocab-hard but syntax-easy, and vice versa |
| `CAREC` | Crowdsourced Algorithm of Reading Comprehension — ML model trained on comprehension outcomes | Mixed | Higher = harder. Modern, but less interpretable |
| `CAREC_M` | CAREC controlled for text length | Mixed | |
| `CML2RI` | Coh-Metrix L2 Readability Index (for second-language readers) | Cohesion features | Higher = easier. Interesting if we ever pitch ESL support |

**The trick we exploit:** Flesch-Kincaid measures *sentence complexity* while Dale-Chall measures *vocabulary load*. Two passages at the same Lexile band can diverge on these — one is vocab-hard, the other syntax-hard. That maps directly onto our Maya/Leo story (comprehension-vs-vocabulary) with real, citable metrics instead of invented labels.

## A fully-annotated record (ID 2002)

| Field | Value | Reading it |
|---|---|---|
| ID | 2002 | |
| Author | Divya Panicker | |
| Title | Have You Ever Heard a Whale Sing? | |
| Anthology | — | Standalone book, not from an anthology |
| URL | freekidsbooks.org/…/have-you-ever-heard-a-whale-sing-Pratham-FKB.pdf | Pratham children's publisher |
| Pub Year | 2020 | Modern children's book |
| Categ | Info | Informational text |
| Sub Cat | — | |
| Lexile Band | 500 | Early-elementary band |
| Location | mid | Cut from the middle of the book |
| License | CC BY 4.0 | Free to use with attribution |
| MPAA Max | G | Kid-safe content |
| MPAA #Max / MPAA# Avg | 1 / 1 | Both raters said G |
| Excerpt | "Whales sing short and long songs…" | Full text in [dataset_samples.md](dataset_samples.md) |
| Google WC | 184 | ~1–2 min read for a young reader |
| Sentence Count | 20 | Avg 9 words/sentence — short sentences |
| Paragraphs | 5 | Renders nicely |
| BT_easiness | 0.33 | Above 0 → teachers judged it on the easier side |
| s.e. | 0.50 | |
| Flesch-Reading-Ease | 85.2 | Easy |
| Flesch-Kincaid-Grade-Level | 3.7 | ~4th grade **syntax** |
| Automated Readability Index | 4.1 | Agrees with FK |
| SMOG Readability | 8 | Higher — SMOG is thrown off by polysyllabic species names |
| New Dale-Chall | 5.95 | ~6th grade **vocabulary** — harder than its syntax! ("composers", "species", "Humpback") |
| CAREC / CAREC_M | 0.072 / 0.048 | Low = easy |
| CML2RI | 24.7 | Mid-range |

This record is the multi-axis story in miniature: syntax says grade 3.7, vocabulary says grade 6. A kid who struggles with it likely has a **vocabulary** gap, not a comprehension one — exactly the distinction our challenges are built to detect.
