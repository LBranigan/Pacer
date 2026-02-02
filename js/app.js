import { initRecorder } from './recorder.js';
import { initFileHandler } from './file-handler.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(reg => console.log('SW registered:', reg.scope))
    .catch(err => console.warn('SW registration failed:', err));
}

initRecorder();
initFileHandler();
