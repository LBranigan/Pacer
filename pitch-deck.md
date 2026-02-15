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
  code {
    color: #7dd3fc;
    background: #1e293b;
    padding: 2px 6px;
    border-radius: 4px;
  }
  footer {
    color: #475569;
    font-size: 0.6em;
  }
  section::after {
    color: #475569;
    font-size: 0.7em;
  }
---

<!-- _class: lead -->
<!-- _paginate: false -->
<!-- _backgroundColor: #0f172a -->

# The Forgotten 40%

### They don't qualify for Special Ed. They pass basic screenings.
### But they devote **90% of their brainpower to decoding** — leaving **0% for comprehension**.

*They've survived by memorizing words and guessing from context. A teacher might think, "They're a little slow, but they're getting the words right."*

<br>

*Pacer — AI-Powered Reading Struggle Detection*

---

<!-- _backgroundColor: #0f172a -->

# Reading Fluency Assessment Is Broken

- Teachers have **120+ students** -- trained to teach content, not diagnose reading

- Current tools measure **words-correct-per-minute** -- a blunt metric that misses *how* students struggle

- **Middle school is the last window** for intervention -- after 8th grade, outcomes calcify

---

<!-- _class: accent -->

# A LeNet Moment for Speech Recognition

- ASR reached a tipping point -- but models trained on **adult, fluent speech**

- Accurate ASR for **disfluent populations** (children, struggling readers) = next frontier

- **Edge compute** makes COPPA/FERPA-compliant classroom deployment practical

- **RTI is mandated** but under-resourced -- schools need tools, not theory

---

<!-- _backgroundColor: #0f172a -->

# A Struggle Detector, Not a Score Generator

- Students read from **real books** -- not a screen -- proven higher instructional value

- Captures hesitations, substitutions, repetitions, omissions, self-corrections

- Rich longitudinal data -- **zero teacher prep**

<br>

> *"A blood pressure cuff for reading -- installed in the classroom, reliable, unobtrusive"*

---

<!-- _backgroundColor: #0f172a -->

# 13-Point Miscue Classification

**Pipeline:** Audio &#8594; Multi-Engine ASR (3 engines) &#8594; Disfluency Detection &#8594; Struggle Classification

<br>

**Errors:** Omission &#8226; Substitution &#8226; Struggle &#8226; Morphological &#8226; Long Pause

**Diagnostic:** Insertion &#8226; Hesitation &#8226; Self-Correction &#8226; Fragments &#8226; Repetitions &#8226; Fillers

**Forgiveness:** Proper Noun Recognition

<br>

*3-engine cross-validation: Reverb + Google STT + Deepgram Nova-3*

---

<!-- _class: accent -->

# $2.4B Market -- Massive Gap in the Middle

- **Core:** Middle School RTI screening (drastically underserved)

- **Adjacent:** Elementary, High School expansion

- **B2C:** SLPs, Private Schools, Homeschool families

- **Data moat:** Every session = proprietary disfluent speech data

---

<!-- _backgroundColor: #0f172a -->

# Positioned Where No One Else Is Playing

<br>

| | Score-Level | Struggle-Level |
|---|---|---|
| **Screen-based** | NWEA MAP, iStation | -- |
| **Physical Books** | Amira ($40M), Ello (YC) | **PACER** |

<br>

*Amira requires talking to a computer. Ello targets K-2. Legacy tools give scores, not insights.*

---

<!-- _backgroundColor: #0f172a -->

# Already in Classrooms

- **Active pilot** at Morningside Academy -- real students, real data

- **Zero bureaucratic friction** -- via Andrew Kieta (precision teaching network)

- Product **functional today**: Word Speed Map, disfluency detection, multi-miscue engine

- **COPPA/FERPA-compliant** architecture from day one

---

<!-- _class: accent -->

# Built for This Problem

<br>

**Emma** -- PhD Vanderbilt &#8226; Mentored by Doug Fuchs (creator of PALs) &#8226; Linguistics + SpEd &#8226; Runs Wing Institute

**Founder** -- 10+ yr entrepreneur &#8226; Built full AI pipeline &#8226; All-in &#8226; Deep technical background

**Network:** Morningside Academy (classroom access) &#8226; Nvidia (family -- distinguished engineer)

---

<!-- _backgroundColor: #0f172a -->

# Land with Screening, Expand with Data

<br>

**1. Land** &#8594; Per-school SaaS for RTI screening

**2. Expand** &#8594; District dashboards + progress monitoring

**3. Defend** &#8594; Proprietary data &#8594; license model weights

<br>

> *Soapbox Labs acquired for ~$100M+ -- for the children's speech data. Then closed API to competitors.*

---

<!-- _class: accent -->

# Accelerate Pacer into 50 Classrooms

### **Seeking Launch.co partnership**

<br>

- **Hire:** First ML engineer
- **Deploy:** Edge hardware in classrooms
- **Validate:** 3 paid district pilots

<br>

**12-month targets:** 50 classrooms &#8226; 3 district LOIs &#8226; Published validation study

---

<!-- _class: lead -->
<!-- _paginate: false -->
<!-- _backgroundColor: #0f172a -->

# Every Struggling Reader Found.
## None Left Behind.

<br>

*Pacer -- AI-Powered Reading Struggle Detection*
