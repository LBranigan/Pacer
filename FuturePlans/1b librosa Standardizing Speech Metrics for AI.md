This is the correct engineering instinct. You cannot just ask an LLM "is this monotone?" without defining what "monotone" means physically. If you send Gemini raw Hz values, it will hallucinate because it doesn't "hear" the audio.

To make this production-ready, you need to normalize your raw acoustic data into **Standardized Linguistic Metrics** derived from research.

Here are the specific, research-backed thresholds you need to code into your Python "Phase B" layer.

### **1\. The "Monotone" Metric: Pitch Variability**

**Do not use raw Hertz (Hz).** A 20Hz variation is massive for a deep male voice but tiny for a child. You must convert pitch to **Semitones (ST)** to match human perception.

* **The Metric:** **Semitone Standard Deviation (ST-SD)** over the course of a sentence.  
* **The Research:** Research on oral reading prosody indicates that "expressive" reading shows a significantly higher standard deviation in fundamental frequency compared to "flat" reading. Studies on children specifically show that "monotone" or "atypical" prosody often manifests as a compressed pitch range.  
* **The Thresholds (for your Python logic):**  
  * **\< 2.0 Semitones (SD):** **Monotone** (Robotic/Flat). The student is likely decoding word-by-word without comprehension.  
  * **2.0 \- 4.0 Semitones (SD):** **Neutral/Developing.** Typical of routine statements but lacks "storytelling" energy.  
  * **\> 4.0 Semitones (SD):** **Expressive.** This correlates with NAEP Level 4 "Expressive interpretation".

**Implementation Note:**

Use librosa or numpy to convert your CREPE Hz array to semitones relative to the student's *mean* pitch before calculating SD.

$$ST \= 12 \\times \\log\_2\\left(\\frac{f}{\\text{f\\\_ref}}\\right)$$

### **2\. The "Phrasing" Metric: Pause Duration**

**Not all silence is a pause.** You need to distinguish between "articulatory gaps" (like the silence before a 'P' or 'K' sound) and actual "hesitations".

* **The Metric:** **Ungrammatical Pause Duration.**  
* **The Research:** The classic psycholinguistic threshold for a "cognitive hesitation" (as opposed to articulation) is **250ms**. Recent studies suggest listeners perceive disfluency starting as low as **\~125ms**, but for automated grading, 250ms is a safer "fair" threshold to avoid false positives.  
* **The Thresholds:**  
  * **\< 250ms:** **Ignored** (Treat as fluent connection).  
  * **\> 250ms (at punctuation):** **Valid Pause** (Good phrasing).  
  * **\> 250ms (no punctuation):** **"Pause Intrusion"** (Bad phrasing). This is the key metric for NAEP Level 1 vs 3\.

### **3\. The "Intonation" Metric: Sentence-Final Slope**

To determine if a student understands syntax, you must check the pitch contour at the *end* of sentences.

* **The Metric:** **Linear Regression Slope** of the last 300ms of voiced speech in a sentence.  
* **The Research:** "Sentence-final F0 change" is a primary indicator of prosodic competence.  
* **The Thresholds:**  
  * **Statements (periods):** Must have a **Negative Slope** (falling pitch). A Flat or Positive slope indicates "list reading" or uncertainty (uptalk).  
  * **Questions (question marks):** Must have a **Positive Slope** (rising pitch).  
  * **Logic:** If punctuation \== "?" and slope \< 0.5 (flat/falling), flag as "Expression Mismatch".

### **Updated "Bridge" JSON Structure**

Now you can give Gemini "decisions" rather than "data." Update your Python extraction schema to this:

JSON

{  
  "student\_metrics": {  
    "pitch\_score": {  
      "value": 1.8,  
      "unit": "semitone\_sd",  
      "verdict": "MONOTONE" // Python decided this based on \<2.0 threshold  
    },  
    "phrasing\_score": {  
      "total\_pauses": 12,  
      "ungrammatical\_pauses": 8, // Pauses \>250ms at non-punctuation indices  
      "verdict": "CHOPPY" // Python decided this based on \>10% intrusion rate  
    },  
    "intonation\_check": {  
      "sentence\_end\_mismatches": 2, // e.g., Rising pitch at a period  
      "total\_sentences": 5  
    }  
  }  
}

