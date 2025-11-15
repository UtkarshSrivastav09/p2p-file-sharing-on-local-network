/* script.js
   Features:
   - Dark mode toggle (persisted)
   - Toast notifications
   - Sound notifications
   - Activity log (side panel, localStorage)
   - QR code share (qrious)
*/

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const clickToChoose = document.getElementById('clickToChoose');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressName = document.getElementById('progressName');
const filesTbody = document.getElementById('filesTbody');
const peersList = document.getElementById('peersList');
const serverInfo = document.getElementById('serverInfo');

const toastBox = document.getElementById('toastBox');
const toggleThemeBtn = document.getElementById('toggleTheme');
const soundToggle = document.getElementById('soundToggle');
const openActivityBtn = document.getElementById('openActivity');
const activityPanel = document.getElementById('activityPanel');
const closeActivityBtn = document.getElementById('closeActivity');
const activityList = document.getElementById('activityList');
const clearLogBtn = document.getElementById('clearLog');

const qrModal = document.getElementById('qrModal');
const qrCanvas = document.getElementById('qrCanvas');
const closeQR = document.getElementById('closeQR');
const downloadQR = document.getElementById('downloadQR');

let localIp = null;
let port = 8000;

function showToast(message, type = "info", ttl = 3000) {
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.innerText = message;
  toastBox.appendChild(div);
  setTimeout(() => { div.style.opacity = '0'; setTimeout(()=> div.remove(), 300); }, ttl);
}

// WebAudio tone for feedback
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playTone(type = 'info') {
  if (!soundToggle.checked) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sine';
  if (type === 'success') o.frequency.value = 880;
  else if (type === 'error') o.frequency.value = 220;
  else o.frequency.value = 440;
  g.gain.value = 0.06;
  o.connect(g); g.connect(audioCtx.destination);
  o.start();
  setTimeout(()=> { o.stop(); }, 140);
}

// Activity log
const LOG_KEY = 'p2p_activity_log_v1';
function addActivity(text) {
  const ts = Date.now();
  const entry = { ts, text };
  let logs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
  logs.unshift(entry);
  if (logs.length > 200) logs = logs.slice(0,200);
  localStorage.setItem(LOG_KEY, JSON.stringify(logs));
  renderActivity();
}
function renderActivity() {
  const logs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
  activityList.innerHTML = '';
  if (logs.length === 0) {
    activityList.innerHTML = '<div class="faded small p-2">No activity yet</div>';
    return;
  }
  logs.forEach(l => {
    const d = new Date(l.ts);
    const el = document.createElement('div');
    el.className = 'activity-item small';
    el.innerHTML = `<div class="text-xs faded">${d.toLocaleString()}</div><div class="mt-1">${escapeHtml(l.text)}</div>`;
    activityList.appendChild(el);
  });
}
clearLogBtn.addEventListener('click', ()=>{
  if (!confirm('Clear activity log?')) return;
  localStorage.removeItem(LOG_KEY);
  renderActivity();
  showToast('Activity log cleared', 'info');
  playTone('info');
});

// helpers
function escapeHtml(unsafe='') {
  return (unsafe + '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
function humanBytes(bytes) {
  if (!bytes && bytes !== 0) return '-';
  if (bytes === 0) return '0 B';
  const sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i?2:0) + ' ' + sizes[i];
}
function fmtDate(ts) { return new Date(ts * 1000).toLocaleString(); }

// theme
// const THEME_KEY = 'p2p_theme_dark';
// function applyTheme() {
//   const dark = localStorage.getItem(THEME_KEY) === '1';
//   if (dark) document.documentElement.classList.add('dark-mode');
//   else document.documentElement.classList.remove('dark-mode');
// }
// toggleThemeBtn.addEventListener('click', ()=>{
//   const dark = !(localStorage.getItem(THEME_KEY) === '1');
//   localStorage.setItem(THEME_KEY, dark ? '1' : '0');
//   applyTheme();
// });
// applyTheme();

// server info / files / peers
async function loadInfo() {
  try {
    const res = await fetch('/api/info');
    const info = await res.json();
    localIp = info.local_ip;
    port = info.port;
    serverInfo.innerHTML = `<span class="small">Server: ${localIp}:${port}</span>`;
    addActivity(`Loaded server info: ${localIp}:${port}`);
  } catch {
    serverInfo.innerText = 'Server info unavailable';
    showToast('Unable to load server info', 'error');
    playTone('error');
    addActivity('Failed to load server info');
  }
}

async function fetchFiles() {
  try {
    const res = await fetch('/api/files');
    const files = await res.json();
    filesTbody.innerHTML = '';
    for (const f of files) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="py-2">${escapeHtml(f.name)}</td>
        <td class="py-2">${humanBytes(f.size)}</td>
        <td class="py-2">${fmtDate(f.mtime)}</td>
        <td class="py-2">
          <a class="text-indigo-600 mr-3" href="/downloadfile/${encodeURIComponent(f.name)}" target="_blank">Download</a>
          <button data-name="${escapeHtml(f.name)}" class="deleteBtn text-sm text-red-600 mr-3">Delete</button>
          <button data-name="${escapeHtml(f.name)}" class="copyBtn text-sm text-slate-700 mr-3">Copy Link</button>
          <button data-name="${escapeHtml(f.name)}" class="qrBtn text-sm text-slate-700">QR</button>
        </td>
      `;
      filesTbody.appendChild(tr);
    }

    // bind actions
    document.querySelectorAll('.deleteBtn').forEach(btn=>{
      btn.addEventListener('click', async (e)=>{
        const name = e.currentTarget.dataset.name;
        if (!confirm(`Delete "${name}"?`)) return;
        try {
          await fetch('/deletefile/' + encodeURIComponent(name), { method: 'POST' });
          showToast('File deleted', 'info');
          playTone('info');
          addActivity(`Deleted file: ${name}`);
          await fetchFiles();
        } catch {
          showToast('Failed to delete', 'error');
          playTone('error');
          addActivity(`Failed to delete file: ${name}`);
        }
      });
    });

    document.querySelectorAll('.copyBtn').forEach(btn=>{
      btn.addEventListener('click', async (e)=>{
        const name = e.currentTarget.dataset.name;
        const link = `http://${localIp}:${port}/downloadfile/${encodeURIComponent(name)}`;
        try {
          await navigator.clipboard.writeText(link);
          showToast('Link copied to clipboard', 'success');
          playTone('success');
          addActivity(`Copied link: ${link}`);
        } catch {
          showToast('Copy failed — showing prompt', 'error');
          playTone('error');
          addActivity(`Copy failed for: ${name}`);
          prompt('Copy this link', link);
        }
      });
    });

    document.querySelectorAll('.qrBtn').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        const name = e.currentTarget.dataset.name;
        const link = `http://${localIp}:${port}/downloadfile/${encodeURIComponent(name)}`;
        openQrModal(link);
        addActivity(`Opened QR for: ${name}`);
      });
    });

  } catch {
    filesTbody.innerHTML = '<tr><td colspan="4" class="py-4 faded small">Unable to load files</td></tr>';
    showToast('Unable to load files', 'error');
    playTone('error');
    addActivity('Failed to fetch file list');
  }
}

async function fetchPeers() {
  try {
    const res = await fetch('/api/peers');
    const peers = await res.json();
    peersList.innerHTML = '';
    for (const p of peers) {
      const li = document.createElement('li');
      li.className = 'p-3 rounded-lg border';
      li.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="font-medium">${p.ip}</div>
          <div class="text-xs faded">${p.url}</div>
        </div>
        <div class="mt-2">
          <button data-ip="${p.ip}" class="viewRemoteBtn small py-1 px-2 rounded btn">View Files</button>
        </div>
        <div class="remoteFiles mt-2 small"></div>
      `;
      peersList.appendChild(li);
    }

    document.querySelectorAll('.viewRemoteBtn').forEach(btn=>{
      btn.addEventListener('click', async (e)=>{
        const ip = e.currentTarget.dataset.ip;
        const parent = e.currentTarget.closest('li');
        const remoteDiv = parent.querySelector('.remoteFiles');
        remoteDiv.innerHTML = 'Loading...';
        try {
          const res = await fetch(`http://${ip}:${port}/api/files`);
          if (!res.ok) throw new Error('fail');
          const files = await res.json();
          if (files.length === 0) {
            remoteDiv.innerHTML = '<div class="faded small">No files shared</div>';
            return;
          }
          const container = document.createElement('div');
          files.forEach(f=>{
            const a = document.createElement('a');
            a.href = `http://${ip}:${port}/downloadfile/${encodeURIComponent(f.name)}`;
            a.target = '_blank';
            a.className = 'block text-indigo-600 hover:underline small';
            a.innerText = `${f.name} — ${humanBytes(f.size)}`;
            container.appendChild(a);
          });
          remoteDiv.innerHTML = '';
          remoteDiv.appendChild(container);
          addActivity(`Viewed files from peer ${ip}`);
        } catch {
          remoteDiv.innerHTML = '<div class="text-red-600 small">Unable to fetch remote files</div>';
          showToast('Unable to fetch remote files', 'error');
          playTone('error');
          addActivity(`Failed to fetch from ${ip}`);
        }
      });
    });

  } catch {
    peersList.innerHTML = '<li class="small faded">Unable to fetch peers</li>';
  }
}

// upload
dropZone.addEventListener('dragover', (e)=>{ e.preventDefault(); dropZone.classList.add('ring-2','ring-indigo-300'); });
dropZone.addEventListener('dragleave', ()=>{ dropZone.classList.remove('ring-2','ring-indigo-300'); });
dropZone.addEventListener('drop', (e)=>{ e.preventDefault(); dropZone.classList.remove('ring-2','ring-indigo-300'); const f = e.dataTransfer.files[0]; if (f) uploadFile(f); });
clickToChoose.addEventListener('click', ()=> fileInput.click());
fileInput.addEventListener('change', ()=> { const f = fileInput.files[0]; if (f) uploadFile(f); });

function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  progressContainer.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressName.innerText = file.name;

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/uploadfile/');
  xhr.upload.addEventListener('progress', (evt)=>{
    if (evt.lengthComputable) {
      const pct = Math.round((evt.loaded / evt.total) * 100);
      progressBar.style.width = pct + '%';
    }
  });
  xhr.addEventListener('load', async ()=>{
    progressBar.style.width = '100%';
    showToast('Upload completed', 'success');
    playTone('success');
    addActivity(`Uploaded: ${file.name} (${humanBytes(file.size)})`);
    setTimeout(()=> progressContainer.classList.add('hidden'), 600);
    fileInput.value = '';
    await fetchFiles();
  });
  xhr.addEventListener('error', ()=>{
    showToast('Upload failed', 'error');
    playTone('error');
    addActivity(`Upload failed: ${file.name}`);
    progressContainer.classList.add('hidden');
  });
  xhr.send(formData);
}

// QR modal functions
function openQrModal(link) {
  try {
    const qr = new QRious({ element: qrCanvas, value: link, size: 220, level: 'M' });
  } catch (e) {
    const ctx = qrCanvas.getContext && qrCanvas.getContext('2d');
    if (ctx) { ctx.clearRect(0,0,220,220); ctx.font = '12px sans-serif'; ctx.fillText('QR lib not loaded', 10, 20); }
  }
  qrModal.classList.remove('hidden');
}
closeQR.addEventListener('click', ()=> qrModal.classList.add('hidden'));
downloadQR.addEventListener('click', ()=>{
  try {
    const url = qrCanvas.toDataURL('image/png');
    const a = document.createElement('a'); a.href = url; a.download = 'share-qr.png'; a.click();
  } catch (e) {
    showToast('Unable to download QR', 'error');
  }
});

// activity panel
openActivityBtn.addEventListener('click', ()=> { activityPanel.classList.add('open'); renderActivity(); });
closeActivityBtn.addEventListener('click', ()=> activityPanel.classList.remove('open'));

// init
(async ()=> {
  await loadInfo();
  await fetchFiles();
  await fetchPeers();
  renderActivity();
  setInterval(fetchFiles, 5000);
  setInterval(fetchPeers, 3000);
})();

// resume audio on user gesture
document.addEventListener('click', ()=> { if (audioCtx.state === 'suspended') audioCtx.resume(); }, { once: true });
