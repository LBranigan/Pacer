You are correct to be cautious. Google's official stance is often summarized as "send us the cleanest raw audio possible," but there is a crucial nuance between **Acoustic Pre-processing** (which you should avoid) and **Technical Format Pre-processing** (which you should definitely do).

### **1\. The "No Pre-processing" Rule: What to Avoid**

Google recommends **disabling** certain acoustic enhancements because their deep learning models (like latest\_long) are already trained on massive datasets of noisy, real-world audio.

Applying these can actually **decrease** accuracy by introducing digital artifacts that confuse the model:

* **Noise Suppression/Cancellation:** Do not use software to "strip out" background hum before sending it to Google.  
* **Automatic Gain Control (AGC):** This can fluctuate the volume in a way that masks the natural "energy" of a student's voice.  
* **Heavy Equalization:** Avoid boosting or cutting specific frequencies (like high-pass filters) unless absolutely necessary.

### ---

**2\. Where Librosa Fits In**

Librosa is a "Swiss Army Knife" for audio. While it is famous for **Prosody Data** (pitch and energy), it is also the standard tool for the **Technical Pre-processing** that Google *wants* you to perform to ensure your file is compatible.

| Task Type | Should you do it? | Librosa Function | Why? |
| :---- | :---- | :---- | :---- |
| **Resampling** | **Yes** | librosa.resample | Google recommends a minimum of 16kHz for high accuracy. |
| **Mono Conversion** | **Yes** | librosa.load(mono=True) | Multi-channel audio can confuse the engine; mono is the optimized standard. |
| **Normalization** | **Optional** | librosa.util.normalize | Ensures the "loudness" is consistent across different recordings without distorting the signal. |
| **Prosody Analysis** | **Yes** | librosa.feature.rms | Used for your RTI Tier 2 diagnostics, not for the ASR itself. |

### ---

**3\. The "Ideal" ORF Pipeline**

From a first-principles perspective for your **Reading Fluency** app, you should treat your audio as two separate data streams:

1. **The ASR Stream (Transcription):**  
   * Use **Librosa** only to load the file, ensure it's at **16kHz**, and convert it to **Mono**.  
   * Send this "technically clean" but "acoustically raw" audio to latest\_long.  
2. **The Diagnostic Stream (Prosody):**  
   * Use **Librosa** to calculate **Pitch ($F\_{0}$)** and **Energy (RMS)**.  
   * Align these Librosa data points with the timestamps Google returns.

**Key Takeaway:** You use Librosa to make sure the audio "fits the pipe" for Google, and then use it again to extract the "soul" (prosody) of the reading for your RTI reports.

#