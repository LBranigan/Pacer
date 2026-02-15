---
marp: true
theme: uncover
paginate: true
style: |
  section {
    background-color: #0f172a;
    color: #f1f5f9;
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    padding: 60px 80px;
  }
  h1 {
    color: #ffffff;
    font-size: 2.4em;
    font-weight: 700;
    margin-bottom: 0.3em;
    line-height: 1.15;
  }
  h2 {
    color: #7dd3fc;
    font-size: 1.5em;
    font-weight: 600;
  }
  h3 {
    color: #94a3b8;
    font-size: 1.1em;
    font-weight: 400;
    line-height: 1.5;
  }
  strong {
    color: #38bdf8;
  }
  em {
    color: #94a3b8;
    font-style: italic;
  }
  ul {
    font-size: 0.95em;
    line-height: 1.7;
  }
  li {
    margin-bottom: 0.35em;
  }
  blockquote {
    border-left: 4px solid #0891b2;
    padding-left: 20px;
    margin-top: 20px;
    font-size: 0.9em;
    color: #cbd5e1;
  }
  table {
    font-size: 0.85em;
    margin-top: 20px;
    border-collapse: collapse;
    width: 100%;
  }
  th {
    background-color: #1e293b;
    color: #7dd3fc;
    padding: 12px 16px;
    text-align: left;
    border-bottom: 2px solid #0891b2;
  }
  td {
    padding: 10px 16px;
    border-bottom: 1px solid #334155;
    color: #e2e8f0;
  }
  section.lead {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
  }
  section.lead h1 {
    font-size: 2.8em;
  }
  section.accent {
    background: linear-gradient(135deg, #0891b2 0%, #0ea5e9 100%);
    color: #ffffff;
  }
  section.accent h1 {
    color: #ffffff;
  }
  section.accent strong {
    color: #e0f2fe;
  }
  section.accent em {
    color: #e0f2fe;
  }
  a {
    color: #38bdf8;
  }
  footer {
    color: #475569;
    font-size: 0.6em;
  }
  section::after {
    color: #475569;
    font-size: 0.7em;
  }
  .stat-row {
    display: flex;
    justify-content: center;
    gap: 60px;
    margin: 30px 0;
  }
  .stat {
    text-align: center;
  }
  .stat-num {
    font-size: 2.5em;
    font-weight: 800;
    color: #38bdf8;
  }
  .stat-label {
    font-size: 0.75em;
    color: #94a3b8;
    margin-top: 4px;
  }
---

<!-- _class: lead -->
<!-- _paginate: false -->

# The Forgotten 40%

### 70% of 8th graders aren't proficient in reading. **34% can barely decode text.**
### The system built to catch them -- RTI -- runs on clipboard tallies and guesswork.

<br>

*Pacer -- AI-Powered Reading Struggle Detection*

---

<!-- _backgroundColor: #0f172a -->

# The Problem: Nobody Knows *How* Kids Struggle

- **120+ students per teacher** -- trained to teach content, not diagnose reading

- Current tools give **words-per-minute** -- a blunt number that misses hesitations, partial attempts, self-corrections

- **Middle school is the last window** -- after 8th grade, outcomes calcify

- ASR works great for adults (~95% accuracy). For struggling children? **~35%.** That gap is the opportunity.

---

<!-- _class: accent -->

# Pacer: A Struggle Detector, Not a Score Generator

- Students read from **real books** -- not a screen -- into a classroom mic

- **3-engine ASR pipeline** cross-validates every word: catches what one engine misses

- **13 miscue types** detected: hesitations, substitutions, self-corrections, fragments, omissions, repetitions...

- Rich per-word data -- duration, pace, struggle path -- **zero teacher prep**

> *"A Fitbit for reading fluency -- reliable, unobtrusive, a force multiplier for teachers."*

---

<!-- _backgroundColor: #0f172a -->

# Traction & Market

- **Live pilot** at Morningside Academy -- real students, real data, zero bureaucratic friction

- **$2.4B market** -- middle school RTI is drastically underserved (competitors target K-2 or screen-only)

- **Data moat:** every session = proprietary disfluent children's speech -- the scarcest dataset in EdTech ASR

<br>

| | Score-Level | **Struggle-Level** |
|---|---|---|
| **Screen-based** | NWEA, iStation | -- |
| **Physical Books** | Amira ($40M), Ello (YC) | **PACER** |

---

<!-- _class: accent -->

# Team & Why Us

**Emma Hendricks** -- PhD Vanderbilt (#1 SpEd program) &#8226; Mentored by Doug Fuchs (creator of PALs) &#8226; Runs Wing Institute

**Liam Branigan** -- 10+ yr entrepreneur &#8226; Built full AI pipeline solo &#8226; All-in, 7 days/week

**Network:** Morningside Academy (free classroom access + pilot) &#8226; Nvidia (family -- distinguished engineer) &#8226; Andrew Kieta (precision teaching network)

> *Soapbox Labs was acquired for its children's speech data alone. Then closed their API to everyone.*

---

<!-- _class: lead -->
<!-- _paginate: false -->

# Every Struggling Reader Found.

## Seeking Launch.co partnership to put Pacer in **50 classrooms** in 12 months.

<br>

**Hire** first ML engineer &#8226; **Deploy** edge hardware &#8226; **Validate** with 3 paid district pilots

<br>

*Pacer -- AI-Powered Reading Struggle Detection*
