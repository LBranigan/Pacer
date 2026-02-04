This is the final, hardened Engineering Design Document for **The Surveyor**.

This plan incorporates the "Face Checks" we performed: it accounts for silence compression (the "Accordion Effect"), handles the "Zero Anchor" failure state, and prioritizes topological order over strict linearity.

You can hand this directly to Claude or your engineering lead.

# ---

**V7 Phase 2: The Surveyor (Robust Alignment Engine)**

**Objective:** Solve the non-linear time drift between the Scribe (latest\_long) and Auditor (default) streams caused by silence compression and processing latency.

**Core Concept:** Shift from **Chronological Alignment** (assuming timestamps are true) to **Topological Alignment** (assuming the *order* of words is true, but time is elastic).

## ---

**1\. The Algorithm Pipeline**

We introduce a **Pre-Pass** step before the main "Zipper" alignment loop.

### **Step 1: The Anchor Hunt (Criteria)**

We scan both streams to find "Golden Anchors"—pairs of words that are undeniably the same event.

**Selection Logic:** A word W is a Candidate Anchor if:

1. **Phonetic Robustness:** Length ≥ 5 chars (ignores "the", "and").  
2. **Signal Boost:** It is a Tier A (Proper Noun) boosted word OR Length ≥ 7\.  
3. **Local Uniqueness:** The word appears **exactly once** in a ±4.0s window in *both* streams. (Disambiguates "cat... cat... cat").

### **Step 2: The Sanity Filter (Topology Check)**

We filter the candidates to ensure they obey the laws of physics (Time moves forward).

**The "Non-Negative" Rule:**

Since latest\_long compresses silence, we **cannot** enforce a strict linear slope (e.g., 1 scribe second \= 1 auditor second). We can only enforce **Sequence**.

* **Rule:** Anchor\[i\].auditorTime MUST be \> Anchor\[i-1\].auditorTime.  
* **Action:** If an anchor violates the sequence (appears to travel backward in time relative to the previous anchor), **discard it**. It is a spurious match.

### **Step 3: The Map Building (Interpolation)**

We construct a lookup function getProjectedTime(scribeTime) that maps the distorted Scribe timeline to the truthful Auditor timeline.

**Logic:**

* Between two anchors, use **Linear Interpolation**.  
* *Why:* If Scribe compressed a 5s silence into 0.1s, the interpolation will inherently "stretch" that 0.1s gap back into 5s on the Auditor side, placing the search window correctly in the silence.

### **Step 4: The Zipper Loop (Execution)**

We replace the static window logic with a **Projected Window**.

* **Input:** scribeWord.startTime (e.g., 10.0s)  
* **Projection:** map.project(10.0s) \-\> Returns 12.4s  
* **Window:** 12.4s ± 0.5s (Tight, accurate window).

## ---

**2\. Robustness & Fallbacks (The "Face Check" Fixes)**

This is the critical "Safety Layer" to prevent crashes on bad data.

### **A. The "Total Meltdown" Fallback (0-1 Anchors)**

If the student mumbles the whole time and we find \< 2 anchors, the map is impossible to build.

* **Action:** Revert to **Global Median Offset**.  
* **Logic:** Calculate offset \= median(auditorTime \- scribeTime) for *all* matches (even weak ones). Apply scribeTime \+ offset as a static shift.

### **B. The "Uncertainty Principle" (Window Expansion)**

If the gap between two anchors is huge (e.g., \> 10 seconds), our interpolation becomes less trustworthy.

* **Action:** Dynamically expand the search window based on distance from the nearest anchor.  
* **Formula:** padding \= 0.5s \+ (distanceFromAnchor \* 0.1).  
  * *Effect:* Right next to an anchor, the window is tight (0.5s). In the middle of a 20s gap, the window loosens to \~1.5s to catch drift.

### **C. The "Edge Clamp"**

Don't let the projection extrapolate wildly before the first anchor or after the last.

* **Action:** For times *outside* the anchor range, use the **Global Median Offset** rather than linear extrapolation (which can shoot off to infinity if the slope of the first/last segment is steep).

## ---

**3\. Implementation Specification (Pseudo-Code)**

Copy this into your prompt for Claude to generate the actual TypeScript/Python.

JavaScript

/\*\*  
 \* PHASE 2: THE SURVEYOR  
 \* Robust Time-Alignment Utility  
 \*/

// 1\. ANCHOR FINDER  
function findAnchors(scribeStream, auditorStream) {  
  // Config  
  const MIN\_LEN \= 5;  
  const UNIQUE\_WINDOW \= 4.0; // seconds

  const candidates \= scribeStream  
    .filter(w \=\> w.word.length \>= MIN\_LEN || w.boostFactor \> 1.0)  
    .map(sWord \=\> {  
      // Find matches in Auditor stream within generous window  
      const matches \= auditorStream.filter(aWord \=\>   
        aWord.word \=== sWord.word &&   
        Math.abs(aWord.startTime \- sWord.startTime) \< 10.0 // loose rough bound  
      );

      // Strict Uniqueness Check  
      // Filter out if multiple matches exist closely in auditor stream  
      const distinctMatches \= matches.filter(m \=\> isLocallyUnique(m, matches, UNIQUE\_WINDOW));  
        
      if (distinctMatches.length \=== 1) {  
        return { scribe: sWord, auditor: distinctMatches\[0\] };  
      }  
      return null;  
    })  
    .filter(Boolean); // Remove nulls

  return sanitizeSequence(candidates);  
}

// 2\. SANITIZER (Topology Check)  
function sanitizeSequence(anchors) {  
  const clean \= \[\];  
  let lastAuditorTime \= \-1;

  for (const anchor of anchors) {  
    // Time must move forward  
    if (anchor.auditor.startTime \> lastAuditorTime) {  
      clean.push(anchor);  
      lastAuditorTime \= anchor.auditor.startTime;  
    } else {  
      console.warn("Skipping Out-of-Sequence Anchor:", anchor.scribe.word);  
    }  
  }  
  return clean;  
}

// 3\. THE PROJECTION MAP  
class TimeMapper {  
  constructor(anchors, globalMedianOffset) {  
    this.anchors \= anchors;  
    this.fallbackOffset \= globalMedianOffset;  
  }

  project(scribeTime) {  
    // Edge Case: Not enough data  
    if (this.anchors.length \< 2) return scribeTime \+ this.fallbackOffset;

    // Find surrounding anchors  
    const prev \= this.anchors.findLast(a \=\> a.scribe.startTime \<= scribeTime);  
    const next \= this.anchors.find(a \=\> a.scribe.startTime \> scribeTime);

    // Edge Case: Outside bounds (Clamp to fallback offset behavior to prevent wild extrapolation)  
    if (\!prev || \!next) return scribeTime \+ this.fallbackOffset;

    // Interpolate  
    const scribeGap \= next.scribe.startTime \- prev.scribe.startTime;  
    const auditorGap \= next.auditor.startTime \- prev.auditor.startTime;  
      
    // Safety: Prevent divide by zero  
    if (scribeGap \< 0.01) return prev.auditor.startTime;

    const ratio \= (scribeTime \- prev.scribe.startTime) / scribeGap;  
    return prev.auditor.startTime \+ (auditorGap \* ratio);  
  }  
    
  // Dynamic Window Sizing (The Uncertainty Principle)  
  getWindowSize(scribeTime) {  
    const basePadding \= 0.5;  
    if (this.anchors.length \< 2) return basePadding;

    const prev \= this.anchors.findLast(a \=\> a.scribe.startTime \<= scribeTime);  
    // If we are far from an anchor (e.g. 5s), add extra padding  
    const dist \= prev ? (scribeTime \- prev.scribe.startTime) : 0;  
      
    return basePadding \+ (Math.min(dist, 5.0) \* 0.1); // Max extra padding of 0.5s  
  }  
}

## ---

**4\. Final Checklist**

Before you ship:

1. \[ \] **Run the "Silence Test":** Record a file: "Hello \[5s silence\] World". Ensure the Surveyor maps the silence correctly and doesn't flag "World" as a rate anomaly.  
2. \[ \] **Check the Logs:** Ensure Skipping Out-of-Sequence Anchor isn't firing on valid data (which would imply your uniqueness window is too loose).  
3. \[ \] **Verify Boosts:** Ensure your Tier A words (Student Name, School Name) are being caught as anchors. These are your "Ironclad" points.

This plan is robust, handles the "Accordion Effect," and degrades gracefully if the audio is garbage. You are ready to build.