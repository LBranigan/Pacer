import { setStatus } from './ui.js';

let mediaRecorder, audioChunks = [], recording = false, timerInterval, seconds = 0;
let onComplete = null;

export function setOnComplete(fn) { onComplete = fn; }

function toggleRecord() {
  recording ? stopRecording() : startRecording();
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: 48000, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', bitsPerSecond: 128000 });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      if (onComplete) onComplete(blob, 'WEBM_OPUS', seconds);
    };
    mediaRecorder.start();
    recording = true;
    seconds = 0;
    document.getElementById('recordBtn').textContent = 'Stop';
    document.getElementById('recordBtn').classList.add('recording');
    timerInterval = setInterval(() => {
      seconds++;
      const m = Math.floor(seconds / 60), s = seconds % 60;
      document.getElementById('timer').textContent = m + ':' + String(s).padStart(2, '0');
    }, 1000);
    setStatus('Recording...');
  } catch (e) {
    setStatus('Microphone access denied: ' + e.message);
  }
}

function stopRecording() {
  mediaRecorder.stop();
  recording = false;
  clearInterval(timerInterval);
  document.getElementById('recordBtn').textContent = 'Record';
  document.getElementById('recordBtn').classList.remove('recording');
  setStatus('Processing...');
}

export function initRecorder() {
  document.getElementById('recordBtn').addEventListener('click', toggleRecord);
}
