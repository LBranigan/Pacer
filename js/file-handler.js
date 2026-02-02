import { sendToSTT } from './stt-api.js';
import { setStatus } from './ui.js';

function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  const encodingMap = { wav: 'LINEAR16', flac: 'FLAC', ogg: 'OGG_OPUS', webm: 'WEBM_OPUS', mp3: 'MP3' };
  const encoding = encodingMap[ext] || 'ENCODING_UNSPECIFIED';
  setStatus('Uploading ' + file.name + '...');
  sendToSTT(file, encoding);
}

export function initFileHandler() {
  document.getElementById('fileInput').addEventListener('change', handleFile);
}
