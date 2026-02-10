# Disfluency Section Improvement Plan

## Problem

The disfluency container currently displays:

```
Disfluencies: 3 (mostly unclassified)
  Other: 3
```

This tells the teacher nothing actionable. All three disfluencies are typed `unknown` because the classifier can't categorize them, and even if it could, aggregate counts without the actual words are unhelpful.

## Root Cause Analysis

### Why everything is "unknown"

The disfluency classifier (`disfluency-tagger.js`) operates on the **Kitchen Sink alignment** (Reverb verbatim vs Reverb clean). It only sees insertions — words in verbatim but not in clean. Classification uses three checks:

| Check | Logic | Why it misses |
|-------|-------|---------------|
| **Filler** | Word in FILLER_WORDS set (um, uh, er...) | "are", "pro-", "the" are real words |
| **Repetition** | Adjacent entry has same verbatim word | Next-entry check requires `type='insertion'`; second "the" is a `match` |
| **False start** | 1-3 char word, next word starts with it | "pro-" is 4 chars (hyphen); next word is "gous" not "pronounced" |

### Test case (debug JSON `2026-02-10T16-45-33`)

Reference: "Giving those who observe him a pronounced feeling of the utmost respect"

| Disfluent word | KS context | Ref alignment context | Real explanation |
|---|---|---|---|
| **"are"** | ins between "who" and "server" | insertion (extra word before "observe"→"serve" substitution) | Student inserted a word |
| **"pro-"** | ins between "a" and "gous" | substitution for "pronounced" (hyp="pro") | Partial word attempt on "pronounced" |
| **"the"** (8.51s) | ins before "the" (10.11s match) | insertion flagged `_isSelfCorrection: true` | Repeated "the" before re-reading correctly |

## Vetted Findings

Four parallel research agents investigated the proposal. Key findings:

### 1. "pro-" false_start fix is impossible in KS alignment

The false_start detector checks if the **next KS alignment entry** starts with the current word. After "pro-", the next entry is "gous" (the broken tail of the mispronunciation). `"gous".startsWith("pro")` = false. The KS alignment simply doesn't contain the information needed — the connection to "pronounced" only exists in the ref alignment.

### 2. Repetition fix for "the" is valid but narrow

The prevEntry check (line 61) already works for any entry type. The gap is the nextEntry check (line 67), which restricts to `type='insertion'`. Relaxing this to also check `match` entries catches "the the" where the second is a match. Safe change, no false positives found.

### 3. All needed data exists but isn't passed to the renderer

`renderDisfluencySection()` receives only aggregate stats (`{total, byType, rate}`). But `displayAlignmentResults()` — its caller — has access to:

| Data | Variable | Has what we need |
|------|----------|-----------------|
| Individual disfluent words | `transcriptWords` | `.isDisfluency`, `.disfluencyType`, `.word`, `.startTime`, `.endTime` |
| Ref alignment context | `alignment` | `.ref`, `.hyp`, `.type`, `._isSelfCorrection` |
| Audio playback | `audioBlob` / `wordAudioEl` | Timestamps for click-to-play |
| Cross-validation | `transcriptWords[i].crossValidation` | confirmed/unconfirmed/disagreed |

### 4. Disfluent words are filtered before ref alignment

`filterDisfluencies()` removes disfluent words before the Needleman-Wunsch ref alignment runs. So there is **no direct index mapping** from a disfluent word to its ref alignment entry. Context must be derived via temporal adjacency on `transcriptWords`.

## Implementation Plan

### Step 1: Expand `renderDisfluencySection()` signature

**File:** `js/ui.js` (~line 1545)

Current:
```js
function renderDisfluencySection(disfluencyStats)
```

New:
```js
function renderDisfluencySection(disfluencyStats, transcriptWords, alignment)
```

Update the call site (~line 1525) to pass these additional parameters from `displayAlignmentResults()` scope.

### Step 2: Build word-level disfluency list

Inside `renderDisfluencySection()`, walk `transcriptWords` to find words with `isDisfluency: true`. For each, capture:

```js
{
  word: w.word,                    // "pro-", "are", "the"
  type: w.disfluencyType,          // "unknown", "filler", "repetition", "false_start"
  crossValidation: w.crossValidation,  // "unconfirmed", "disagreed", "confirmed"
  startTime: w.startTime,
  endTime: w.endTime,
  transcriptIndex: i,             // index in transcriptWords for scroll-to-play
  // Context: previous and next non-disfluent words from transcriptWords
  prevWord: ...,
  nextWord: ...
}
```

### Step 3: Enrich with ref alignment context

For each disfluent word, scan the `alignment` array for nearby entries that explain what was happening:

- If the next non-disfluent word is a **substitution** in ref alignment (e.g., hyp="serve", ref="observe"), note: "before misread of [observe]"
- If an adjacent insertion in ref alignment is flagged `_isSelfCorrection: true`, note: "self-correction"
- If the disfluent word's text matches an adjacent ref alignment substitution's hyp (e.g., "pro" = hyp for ref "pronounced"), note: "attempt at [pronounced]"

This cross-reference uses word text matching and temporal proximity, NOT index mapping (which is broken by `filterDisfluencies()`).

### Step 4: Render word-level detail with click-to-listen

Replace the current "Other: 3" display with a list of actual words and context:

```
Disfluencies: 3

  "the"    repetition     ...of the | the utmost...     self-correction      [▶]
  "pro-"   extra word     ...a pro- | gous feeling...   near "pronounced"    [▶]
  "are"    extra word     ...who are | serve him...      unconfirmed          [▶]
```

Design notes:
- Each row shows: the word, its classification, a context snippet with the disfluent word highlighted, and any enrichment from ref alignment
- Context snippet uses ~2 words before and after from the transcript
- Classification labels: "filler", "repetition", "false start", "extra word" (replaces "unknown"/"other"), "attempt" (substitution-adjacent unknown)
- Cross-validation status shown as a subtle indicator (unconfirmed = lower confidence the word was really spoken)

### Step 4a: Audio playback — reuse STT Transcript's click-to-play

The STT Transcript section (`ui.js` ~lines 1244-1342) already renders every `transcriptWords` entry — including disfluencies — as clickable spans with:
- Purple `disagree-disfluency` styling for disfluent words
- Rich tooltips showing Reverb v1/v0 transcriptions and cross-validation status
- Click-to-play audio via the shared `wordAudioEl` + `startTime`/`endTime`

Rather than rebuilding audio playback in the disfluency section, each disfluency row's play button (`[▶]`) should **scroll to and activate the corresponding word in the STT Transcript section**:

```js
// In the disfluency row click handler:
playBtn.addEventListener('click', () => {
  // 1. Expand the STT Transcript section if collapsed
  const sttSection = document.getElementById('sttTranscriptSection');
  if (sttSection && !sttSection.classList.contains('expanded')) {
    sttSection.classList.add('expanded');
  }

  // 2. Find the matching word span in STT Transcript disagreement row
  //    Each word span was rendered in order from transcriptWords,
  //    so we can use the transcriptIndex to find the Nth .disagree-word span
  const wordSpans = document.querySelectorAll('#sttTranscriptWords .disagree-word');
  const targetSpan = wordSpans[disfluency.transcriptIndex];

  // 3. Scroll into view and trigger its click (which fires showWordTooltip + audio)
  if (targetSpan) {
    targetSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetSpan.click();
  }
});
```

This approach:
- **Zero audio code duplication** — all playback logic stays in the STT Transcript renderer
- **Leverages existing tooltips** — the disfluency tooltip in STT Transcript already shows Reverb v1/v0 details, cross-validation, and timestamps
- **Creates a navigation link** between the summary (disfluency section) and the detail (STT Transcript section)
- **Requires `transcriptIndex`** on each disfluency entry to map to the correct `.disagree-word` span (the spans are rendered in `transcriptWords` order)

### Step 5: Fix repetition classifier (minor)

**File:** `js/disfluency-tagger.js` (line 67)

Current:
```js
if (nextEntry && nextEntry.type === 'insertion' && normalizeWord(nextEntry.verbatim) === word) {
```

Change to:
```js
if (nextEntry && nextEntry.verbatim && normalizeWord(nextEntry.verbatim) === word) {
```

This catches "the the" where the second "the" is a match (not insertion). The prevEntry check (line 61) already works this way — this makes the logic symmetric.

### Step 6: Strip trailing hyphens for false_start check

**File:** `js/disfluency-tagger.js` (lines 73-78)

Current:
```js
if (word.length >= 1 && word.length <= 3 && nextEntry && nextEntry.verbatim) {
  const nextWord = normalizeWord(nextEntry.verbatim);
  if (nextWord.startsWith(word) && nextWord.length > word.length) {
```

Change to:
```js
const bareWord = word.endsWith('-') ? word.slice(0, -1) : word;
if (bareWord.length >= 1 && bareWord.length <= 3 && nextEntry && nextEntry.verbatim) {
  const nextWord = normalizeWord(nextEntry.verbatim);
  if (nextWord.startsWith(bareWord) && nextWord.length > bareWord.length) {
```

This is safe (no false positives found by vetting) and catches real cases like "un- unhappy", "ca- cat". It does **NOT** fix "pro-" in this test case (next word is "gous"), but catches it in other scenarios where the completion word follows directly.

## What This Does NOT Do

- **Duplicate audio playback code**: Audio plays via the existing STT Transcript section. The disfluency section's play buttons scroll to and activate the corresponding word there (see Step 4a).
- **Fix "pro-" classification in this specific test case**: The KS alignment breaks "pronounced" into "pro-" + "gous", and no single-step classifier can reconnect them. The enrichment in Step 3 handles this by detecting the adjacent substitution for "pronounced" in the ref alignment.
- **Reclassify "are"**: It's genuinely unclassifiable by pattern. The label "extra word" + cross-validation status ("unconfirmed") is the most honest representation.

## Expected Output for Test Case

Before:
```
Disfluencies: 3 (mostly unclassified)
  Other    3
```

After:
```
Disfluencies: 3

  ▶ "the"    repetition     ...of  the | the  utmost...    (self-correction)
  ▶ "pro-"   extra word     ...a  pro- | gous  feeling...  (near "pronounced")
  ▶ "are"    extra word     ...who  are | serve  him...     (unconfirmed)

Rate: 20.0% of words
```

The `▶` button scrolls to the word in the STT Transcript section and triggers its click-to-play audio + tooltip.
