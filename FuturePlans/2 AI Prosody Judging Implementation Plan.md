To implement an AI-based prosody assessment system, you should adopt a **hybrid-cascaded architecture**. This approach uses the word-level timestamps from Google STT latest\_long as "anchors" for signal processing while leveraging multimodal LLMs for holistic, rubric-based evaluation.

Based on 2025–2026 research standards, here is a comprehensive implementation plan to add prosody judging to your classroom app.

### **1\. Define the Measurement Framework**

Prosody is a multidimensional construct. Your system should target the "Big Three" acoustic markers:

* **Pitch ($F\_0$):** Measures intonation (e.g., rising at question marks, falling at periods).  
* **Duration/Timing:** Measures phrasing and "pause intrusions" (pauses \>100ms in inappropriate locations).  
* **Energy (Intensity):** Measures vocal emphasis and stress on "focus words".

### **2\. The Implementation Architecture (Hybrid Cascade)**

#### **Phase A: Linguistic & Temporal Anchoring**

Use your existing Google STT latest\_long configuration to generate the baseline data.

1. **Extract Timestamps:** Ensure enableWordTimeOffsets is true. Capture the startTime and endTime for every word.  
2. **Map to Reference:** Align the STT output to your target passage. Identify "Silence Gaps" between words.  
3. **Identify Disjunctures:** Flag any pause greater than 100ms that does not occur at a punctuation mark. Research identifies these as "forbidden pauses" that signal a breakdown in phrasing.

#### **Phase B: Deterministic Feature Extraction**

Pass the raw audio segments (defined by the STT timestamps) through specialized signal processing tools to get objective data.

1. **Pitch Tracking:** Use **CREPE** (Convolutional Representation for Pitch Estimation). Research indicates CREPE is more resilient to noisy classroom environments and higher-pitched child voices than traditional tools like Praat.  
2. **Intonation Analysis:** Calculate the "pitch slope" for the final word of every sentence. A rising slope at a ? and a falling slope at a . correlates with high-comprehension reading.  
3. **Loudness Variation:** Use **openSMILE** to extract the GeMAPS (Geneva Minimalistic Acoustic Parameter Set) for energy. Compare the relative intensity of nouns and verbs against articles (like "the" or "a") to see if the student is placing emphasis on meaning-carrying words.

#### **Phase C: Holistic Multimodal Scoring**

After calculating objective metrics, use a Multimodal LLM (like **Gemini 1.5 Flash**) to provide the "subjective" final score and coaching feedback.

1. **Prompt Engineering:** Prompt the model with the audio file, the STT transcript, and a standard rubric like the **NAEP 4-point Fluency Scale**.  
2. **Rubric Integration:** Task the AI to score specifically on:  
   * **Level 1 (Monotone):** Primarily word-by-word reading.  
   * **Level 2 (Partial Phrasing):** Some word groupings but awkward pauses.  
   * **Level 3 (Good Phrasing):** Meaningful groups, consistent with syntax.  
   * **Level 4 (Expressive):** Natural-sounding speech with appropriate intonation.

### **3\. Suggested Technical Stack**

| Workflow Step | Recommended Tool | Rationale |
| :---- | :---- | :---- |
| **ASR & Timing** | Google STT V2 latest\_long | High verbatim accuracy and word-level temporal precision.  |
| **Pitch Extraction** | **CREPE** (Python) | Superior performance for child speech; handles background noise natively. |
| **Energy/Loudness** | **openSMILE** | Provides standardized "GeMAPS" prosody features used in clinical research. |
| **Holistic Judge** | **Gemini 1.5 Flash** | Low latency; can "reason" about audio cues to match them to textual emotion. |

### **4\. Logic for the Feedback Engine**

When generating feedback for students or reports for teachers, use these verified thresholds:

* **WCPM Accuracy:** If accuracy is \<95%, prosody metrics should be ignored, as the student is likely still in the "decoding struggle" phase.  
* **Pause Threshold:** Flag students who have \>5 "pause intrusions" per minute as needing "Phrased Text Practice" (e.g., using slashes or "scoops" to mark word groups).  
* **Intonation Match:** If sentence-final pitch changes don't match the punctuation \>30% of the time, suggest "Echo Reading" where the student mimics a fluent recording.

### **5\. Implementation Roadmap**

1. **Month 1:** Pilot the extraction of timestamps from latest\_long. Calculate WCPM and basic pause durations.  
2. **Month 2:** Integrate **CREPE** to visualize pitch contours for teachers. Benchmark these against human "monotone vs. expressive" labels.  
3. **Month 3:** Implement the **Gemini 1.5 Flash** rubric judge. As research suggests multimodal models show \~87% agreement with humans within $\\pm 1$ point, use this as your QA threshold.  
4. **Month 4:** Build the Teacher Dashboard. Focus on "visualizing the bridge" between decoding and comprehension by showing phrasing overlaps with the passage.

### **Performance Expectations**

Automated prosody scoring in 2026 currently achieves an accuracy of about **62.5% to 76%** for exact match with human experts, depending on the number of features used. However, for classroom practice (where $\\pm 1$ point on a 4-point scale is acceptable), performance reaches over **85%**, making it highly viable for non-stakes practice and monitoring.