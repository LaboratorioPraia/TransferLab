const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const { spawn } = require('child_process');

let win;
let tray = null;
let transferDialog = null;
let transferDialogTimer = null;
let isQuitting = false;
let watcher = null;
let watcherPoll = null;
const watchPending = new Set();
const watchDelivered = new Map();
const configPath = () => path.join(app.getPath('userData'), 'settings.json');
const logFile = () => path.join(app.getPath('userData'), 'logs', 'transferlab.log');
const historyFile = () => path.join(app.getPath('userData'), 'history.json');
let downloadedUpdatePath = null;
const defaults = () => ({ deviceId: crypto.randomUUID(), trustedDevices: [], peerTokens: {}, receiveFolder: path.join(os.homedir(), 'Downloads', 'TransferLab'), monitorFolder: '', autoTargetPeerId: '', autoStart: true, settingsVersion: 2 });
async function readConfig() {
  try { const stored = JSON.parse(await fs.promises.readFile(configPath(), 'utf8')); const merged = { ...defaults(), ...stored }; if ((stored.settingsVersion || 0) < 2) { merged.autoStart = true; merged.settingsVersion = 2; await fs.promises.writeFile(configPath(), JSON.stringify(merged, null, 2), 'utf8'); } return merged; }
  catch { const initial = defaults(); await fs.promises.mkdir(path.dirname(configPath()), { recursive: true }); await fs.promises.writeFile(configPath(), JSON.stringify(initial, null, 2), 'utf8'); return initial; }
}
async function writeConfig(patch) {
  const current = await readConfig();
  const next = { ...current, ...patch };
  await fs.promises.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.promises.writeFile(configPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}
async function readHistory() {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(historyFile(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
async function writeHistory(items) {
  const file = historyFile();
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  await fs.promises.writeFile(temp, JSON.stringify(items.slice(-500), null, 2), 'utf8');
  await fs.promises.rename(temp, file);
}
async function addHistory(entry) {
  const items = await readHistory();
  const record = { id: crypto.randomUUID(), at: new Date().toISOString(), retries: 0, ...entry };
  items.push(record);
  await writeHistory(items);
  return record;
}
function compareVersions(a, b) {
  const aa = String(a).replace(/^v/i, '').split('.').map(Number);
  const bb = String(b).replace(/^v/i, '').split('.').map(Number);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const x = aa[i] || 0, y = bb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
function requestBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Muitos redirecionamentos ao baixar a atualização.'));
    https.get(url, { headers: { 'User-Agent': 'TransferLab-Updater', 'Accept': 'application/octet-stream' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        return resolve(requestBuffer(response.headers.location, redirects + 1));
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error('Download HTTP ' + response.statusCode)); }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject).setTimeout(30000, function(){ this.destroy(new Error('Tempo limite da conexão excedido.')); });
  });
}
async function getLatestRelease() {
  const raw = await requestBuffer('https://api.github.com/repos/LaboratorioPraia/TransferLab/releases/latest');
  const release = JSON.parse(raw.toString('utf8'));
  const asset = (release.assets || []).find(item => item.name === 'TransferLab-Setup-' + String(release.tag_name || '').replace(/^v/, '') + '.exe');
  const checksum = (release.assets || []).find(item => item.name === 'SHA256SUMS.txt');
  return { version: String(release.tag_name || '').replace(/^v/, ''), name: release.name || release.tag_name, notes: String(release.body || '').slice(0, 4000), url: release.html_url, assetUrl: asset?.browser_download_url || null, checksumUrl: checksum?.browser_download_url || null };
}
 try { return (await fs.promises.readFile(logFile(), 'utf8')).trim().split('\n').filter(Boolean).slice(-500).map(line => { try { return JSON.parse(line); } catch { return { raw: line }; } }); } catch { return []; } }
async function appendLog(entry) {
  const file = logFile();
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.appendFile(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8');
}
function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAyklEQVR4nM2XwQ2DMAxFU4sdyhrtTjAU3amsUaYop0goiZM4+vnBR4z8HrYVBecGxyOXfC2/PwKyf2aVk0ygwDUiwoJrtaX0Qm8J0RIsiWgE7BDnuF/vwzPv0QFkfLfnOAEPt0jABEJorQRM4L0e0bMaCegIWiTgS2iVmHLFrBtdqpWSo50DKThVQOtmdgSadQuM1gELHC5ghUMFWuBQgRBWuz9dTkLL8lJOwqJA7t7eKzzzPjciZheuLNESDHgk0FsiVXv4z+nwOAEWq1k+NuvrygAAAABJRU5ErkJggg==');
  tray = new Tray(icon);
  tray.setToolTip('TransferLab — monitoramento ativo');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir TransferLab', click: () => { if (win) { win.show(); win.focus(); } } },
    { label: 'Status: em segundo plano', enabled: false },
    { type: 'separator' },
    { label: 'Sair completamente', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => { if (win) { win.show(); win.focus(); } });
}
function createWindow() {
  win = new BrowserWindow({ width: 1180, height: 820, minWidth: 900, minHeight: 640, backgroundColor: '#edf2f5', show: false, frame: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  win.on('close', event => { if (!isQuitting) { event.preventDefault(); win.hide(); } });
  createTray();
}
function showTransferDialog(payload) {
  if (transferDialogTimer) { clearTimeout(transferDialogTimer); transferDialogTimer = null; }
  const safe = JSON.stringify({
    direction: payload.direction === 'receive' ? 'receive' : 'send',
    name: String(payload.name || 'Arquivo').slice(0, 180),
    detail: String(payload.detail || ''),
    percent: Math.max(0, Math.min(100, Number(payload.percent) || 0)),
    status: String(payload.status || 'Em andamento').slice(0, 100)
  }).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><body style="margin:0;background:#edf2f5;font-family:Segoe UI,Arial;color:#202b3a"><main style="margin:18px;padding:24px 26px;border-radius:24px;background:#f7f9fb;box-shadow:12px 12px 28px #d5dde3,-12px -12px 28px #fff"><div style="font-size:10px;letter-spacing:2px;color:#8c9aaa">TRANSFERLAB · <span id="direction"></span></div><h2 id="name" style="font-size:19px;font-weight:600;margin:13px 0 6px;overflow-wrap:anywhere"></h2><div id="detail" style="font-size:12px;color:#8793a1;margin-bottom:22px"></div><div style="height:9px;border-radius:20px;background:#e2e7ed;overflow:hidden;box-shadow:inset 2px 2px 5px #cfd6de"><div id="bar" style="height:100%;width:0;background:linear-gradient(90deg,#3296ed,#3836f2);border-radius:20px;transition:width .2s"></div></div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px"><b id="status" style="font-size:12px;font-weight:500"></b><strong id="percent" style="font-size:15px;color:#3c55e8"></strong></div></main><script>function update(p){document.getElementById('direction').textContent=p.direction==='receive'?'RECEBENDO ARQUIVO':'ENVIANDO ARQUIVO';document.getElementById('name').textContent=p.name;document.getElementById('detail').textContent=p.detail;document.getElementById('bar').style.width=p.percent+'%';document.getElementById('percent').textContent=p.percent+'%';document.getElementById('status').textContent=p.status;}window.update=update;update(${safe});</script></body></html>`;
  if (!transferDialog || transferDialog.isDestroyed()) {
    const area = screen.getPrimaryDisplay().workArea;
    transferDialog = new BrowserWindow({ x: Math.round(area.x + (area.width - 470) / 2), y: Math.round(area.y + (area.height - 205) / 2), width: 470, height: 205, frame: false, resizable: false, movable: true, minimizable: false, maximizable: false, alwaysOnTop: true, show: false, backgroundColor: '#edf2f5', skipTaskbar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    transferDialog.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    transferDialog.once('ready-to-show', () => transferDialog.show());
    transferDialog.on('closed', () => { transferDialog = null; });
  } else {
    transferDialog.webContents.executeJavaScript('window.update(' + safe + ')').catch(() => {});
    if (!transferDialog.isVisible()) transferDialog.show();
  }
  if (payload.done || payload.failed) transferDialogTimer = setTimeout(() => { if (transferDialog && !transferDialog.isDestroyed()) transferDialog.close(); transferDialogTimer = null; }, 4500);
}
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
app.whenReady().then(async () => {
  const cfg = await readConfig();
  app.setLoginItemSettings({ openAtLogin: cfg.autoStart !== false, args: ['--hidden'] });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
}
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
app.on('before-quit', () => { isQuitting = true; if (watcher) { watcher.close(); watcher = null; } if (watcherPoll) { clearInterval(watcherPoll); watcherPoll = null; } if (transferDialogTimer) { clearTimeout(transferDialogTimer); transferDialogTimer = null; } if (transferDialog && !transferDialog.isDestroyed()) transferDialog.close(); if (tray) { tray.destroy(); tray = null; } });
app.on('window-all-closed', () => {});

ipcMain.handle('window-control', async (_e, action) => { if (!win) return false; if (action === 'minimize') win.minimize(); else if (action === 'hide') win.hide(); else if (action === 'close') win.hide(); return true; });
ipcMain.handle('transfer-dialog', async (_e, payload) => { showTransferDialog(payload || {}); return true; });
ipcMain.handle('history-list', async () => (await readHistory()).slice().reverse());
ipcMain.handle('history-record', async (_e, entry) => {
  const safe = {
    direction: entry?.direction === 'receive' ? 'receive' : 'send',
    status: entry?.status === 'success' ? 'success' : 'failed',
    name: String(entry?.name || 'Arquivo').slice(0, 240),
    size: Math.max(0, Number(entry?.size) || 0),
    sourcePath: entry?.direction === 'receive' ? null : (typeof entry?.sourcePath === 'string' ? entry.sourcePath : null),
    remoteDeviceId: String(entry?.remoteDeviceId || '').slice(0, 120),
    error: String(entry?.error || '').slice(0, 1200),
    technical: String(entry?.technical || '').slice(0, 4000)
  };
  return addHistory(safe);
});
ipcMain.handle('history-retry-file', async (_e, id) => {
  const items = await readHistory();
  const item = items.find(x => x.id === id);
  if (!item || item.direction !== 'send' || item.status !== 'failed' || !item.sourcePath) throw new Error('Este registro não possui arquivo de origem disponível para reenvio.');
  const stat = await fs.promises.stat(item.sourcePath);
  if (!stat.isFile()) throw new Error('O arquivo original não está mais disponível.');
  return { path: item.sourcePath, name: item.name, size: stat.size, mtimeMs: stat.mtimeMs };
});
ipcMain.handle('history-mark-retried', async (_e, id) => {
  const items = await readHistory();
  const item = items.find(x => x.id === id);
  if (!item) return false;
  item.retries = (Number(item.retries) || 0) + 1;
  item.lastRetryAt = new Date().toISOString();
  item.status = 'retried';
  await writeHistory(items);
  return true;
});
ipcMain.handle('clear-app-data', async () => {
  const answer = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Cancelar', 'Apagar dados e reiniciar'], defaultId: 0, cancelId: 0, title: 'Instalação limpa', message: 'Apagar configurações, dispositivos confiáveis, histórico e logs?', detail: 'Os arquivos já recebidos nas pastas escolhidas não serão apagados. Esta ação não pode ser desfeita.' });
  if (answer.response !== 1) return { canceled: true };
  await Promise.all([configPath(), historyFile(), path.dirname(logFile())].map(target => fs.promises.rm(target, { recursive: true, force: true })));
  app.relaunch();
  app.exit(0);
  return { canceled: false };
});
ipcMain.handle('check-for-updates', async () => {
  try {
    const release = await getLatestRelease();
    return { ...release, available: !!release.assetUrl && compareVersions(release.version, app.getVersion()) > 0, currentVersion: app.getVersion() };
  } catch (error) {
    await appendLog({ level: 'warning', event: 'update-check-failed', details: { message: error.message } });
    return { available: false, error: error.message, currentVersion: app.getVersion() };
  }
});
ipcMain.handle('download-update', async (_e, assetUrl, checksumUrl, expectedVersion) => {
  if (typeof assetUrl !== 'string' || !assetUrl.startsWith('https://github.com/')) throw new Error('Endereço de atualização inválido.');
  const expectedName = 'TransferLab-Setup-' + String(expectedVersion || '').replace(/^v/, '') + '.exe';
  const tempPath = path.join(app.getPath('temp'), expectedName);
  const buffer = await requestBuffer(assetUrl);
  if (buffer.length < 1024 * 1024 || buffer.subarray(0, 2).toString('ascii') !== 'MZ') throw new Error('O instalador baixado é inválido ou está incompleto.');
  if (checksumUrl) {
    if (!checksumUrl.startsWith('https://github.com/')) throw new Error('Endereço de checksum inválido.');
    const sums = (await requestBuffer(checksumUrl)).toString('utf8');
    const line = sums.split(/\r?\n/).find(value => value.trim().endsWith(expectedName));
    if (!line) throw new Error('Não foi encontrado o SHA-256 deste instalador.');
    const expectedHash = line.trim().split(/\s+/)[0].toLowerCase();
    const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (expectedHash !== actualHash) throw new Error('A verificação SHA-256 do instalador falhou.');
  }
  await fs.promises.writeFile(tempPath, buffer);
  downloadedUpdatePath = tempPath;
  await appendLog({ level: 'info', event: 'update-downloaded', details: { version: expectedVersion, size: buffer.length } });
  return { ok: true, path: tempPath, size: buffer.length };
});
ipcMain.handle('install-update', async () => {
  if (!downloadedUpdatePath || !fs.existsSync(downloadedUpdatePath)) throw new Error('Baixe a atualização antes de instalar.');
  const child = spawn(downloadedUpdatePath, [], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  setTimeout(() => app.quit(), 500);
  return true;
});
ipcMain.handle('device-info', async () => { const c = await readConfig(); return { name: os.hostname(), id: c.deviceId, version: app.getVersion(), platform: process.platform, arch: process.arch }; });
ipcMain.handle('get-settings', async () => { const c = await readConfig(); return { ...c, trustedDevices: c.trustedDevices || [] }; });
ipcMain.handle('save-settings', async (_e, patch) => {
  const allowed = {};
  for (const key of ['receiveFolder', 'monitorFolder', 'autoTargetPeerId', 'autoStart']) if (patch && Object.prototype.hasOwnProperty.call(patch, key)) allowed[key] = patch[key];
  const c = await writeConfig(allowed);
  app.setLoginItemSettings({ openAtLogin: c.autoStart !== false, args: ['--hidden'] });
  return c;
});
ipcMain.handle('store-peer-token', async (_e, receiverId, token) => { const c = await readConfig(); const peerTokens = { ...(c.peerTokens || {}), [String(receiverId)]: String(token) }; await writeConfig({ peerTokens }); return true; });
ipcMain.handle('trust-device', async (_e, device, token) => {
  if (!device || typeof device.id !== 'string' || !device.id || device.id.length > 100) throw new Error('Identificação inválida.');
  const c = await readConfig();
  const list = (c.trustedDevices || []).filter(x => x.id !== device.id);
  list.push({ id: device.id, name: String(device.name || 'Dispositivo').slice(0, 100), token: String(token || ''), addedAt: new Date().toISOString() });
  await writeConfig({ trustedDevices: list });
  await appendLog({ level: 'info', event: 'trusted-device-added', details: { deviceId: device.id } });
  return list;
});
ipcMain.handle('untrust-device', async (_e, id) => {
  const c = await readConfig();
  const list = (c.trustedDevices || []).filter(x => x.id !== id);
  await writeConfig({ trustedDevices: list });
  return list;
});
ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('start-folder-watch', async () => {
  const c = await readConfig();
  if (watcher) { watcher.close(); watcher = null; }
  if (watcherPoll) { clearInterval(watcherPoll); watcherPoll = null; }
  if (!c.monitorFolder) return { ok: false, reason: 'Pasta monitorada não configurada.' };
  if (!c.autoTargetPeerId) return { ok: false, reason: 'Informe o código permanente do dispositivo de destino.' };
  await fs.promises.access(c.monitorFolder, fs.constants.R_OK);
  watchDelivered.clear();
  const baseline = await fs.promises.readdir(c.monitorFolder, { withFileTypes: true });
  for (const entry of baseline) {
    if (!entry.isFile()) continue;
    const full = path.join(c.monitorFolder, entry.name);
    try { const stat = await fs.promises.stat(full); watchDelivered.set(full, stat.size + ':' + stat.mtimeMs); } catch {}
  }
  watcher = fs.watch(c.monitorFolder, { persistent: true }, async (_event, filename) => {
    if (!filename) return;
    const fileName = filename.toString();
    if (/\.(part|tmp|temp|crdownload|download|partial)$/i.test(fileName) || fileName.startsWith('~') || fileName.startsWith('.')) return;
    const full = path.join(c.monitorFolder, fileName);
    if (watchPending.has(full)) return;
    watchPending.add(full);
    let dispatched = false;
    try {
      const stat = await fs.promises.stat(full);
      if (!stat.isFile()) return;
      let previous = '', stable = 0;
      for (let i = 0; i < 600 && stable < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const current = await fs.promises.stat(full);
        if (!current.isFile()) return;
        const signatureNow = current.size + ':' + current.mtimeMs;
        if (signatureNow === previous) stable++; else stable = 0;
        previous = signatureNow;
      }
      if (stable < 30) { await appendLog({ level: 'warning', event: 'monitored-file-never-stabilized', details: { file: path.basename(full) } }); return; }
      const finalStat = await fs.promises.stat(full);
      const signature = finalStat.size + ':' + finalStat.mtimeMs;
      if (watchDelivered.get(full) === signature) return;
      const handle = await fs.promises.open(full, 'r');
      const probe = Buffer.alloc(1);
      if (finalStat.size > 0) await handle.read(probe, 0, 1, 0);
      const afterRead = await handle.stat();
      await handle.close();
      if (afterRead.size !== finalStat.size || afterRead.mtimeMs !== finalStat.mtimeMs) { await appendLog({ level: 'warning', event: 'monitored-file-changed-during-read-check', details: { file: path.basename(full) } }); return; }
      if (win && !win.isDestroyed()) { win.webContents.send('folder-file-ready', { path: full, name: path.basename(full), size: finalStat.size, mtimeMs: finalStat.mtimeMs, signature }); dispatched = true; }
      await appendLog({ level: 'info', event: 'monitored-file-ready', details: { file: path.basename(full) } });
    } catch (e) { await appendLog({ level: 'warning', event: 'folder-watch-file-error', details: { file: path.basename(full), message: e.message } }); }
    finally { if (!dispatched) watchPending.delete(full); }
  });
  watcher.on('error', error => { appendLog({ level: 'error', event: 'folder-watcher-error', details: { message: error.message } }).catch(() => {}); });
  watcherPoll = setInterval(async () => {
    try {
      const entries = await fs.promises.readdir(c.monitorFolder, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || entry.name.startsWith('.') || entry.name.startsWith('~') || /\\.(part|tmp|temp|crdownload|download|partial)$/i.test(entry.name)) continue;
        const full = path.join(c.monitorFolder, entry.name);
        if (!watchPending.has(full)) {
          const stat = await fs.promises.stat(full);
          if (stat.isFile() && watchDelivered.get(full) !== stat.size + ':' + stat.mtimeMs) {
            // Reuse the same readiness pipeline by scheduling a synthetic watcher event.
            setTimeout(() => { if (watcher) watcher.emit('change', entry.name); }, 0);
          }
        }
      }
    } catch (e) { await appendLog({ level: 'warning', event: 'folder-watch-rescan-failed', details: { message: e.message } }); }
  }, 10000);
  watcherPoll.unref?.();
  return { ok: true };
});
ipcMain.handle('folder-file-result', async (_e, file, success) => {
  if (!file || typeof file.path !== 'string') return false;
  const full = path.resolve(file.path);
  if (success && typeof file.signature === 'string') watchDelivered.set(full, file.signature);
  watchPending.delete(full);
  await appendLog({ level: success ? 'info' : 'warning', event: success ? 'monitored-file-transfer-confirmed' : 'monitored-file-transfer-failed', details: { file: path.basename(full) } });
  return true;
});
ipcMain.handle('pick-files', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return [];
  return r.filePaths.map(p => { const stat = fs.statSync(p); return { path: p, name: path.basename(p), size: stat.size, mtimeMs: stat.mtimeMs }; });
});
ipcMain.handle('read-chunk', async (_e, filePath, offset, length, expected = null) => {
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const before = await fd.stat();
    if (expected && (before.size !== expected.size || before.mtimeMs !== expected.mtimeMs)) throw new Error('O arquivo de origem mudou depois de ser selecionado ou estabilizado. Selecione-o novamente após a gravação terminar.');
    const b = Buffer.alloc(length); const { bytesRead } = await fd.read(b, 0, length, offset);
    const after = await fd.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('O arquivo de origem foi alterado durante a leitura. Envio cancelado para evitar arquivo incompleto.');
    return b.subarray(0, bytesRead);
  } finally { await fd.close(); }
});
ipcMain.handle('hash-file', async (_e, filePath, expected = null) => {
  const before = await fs.promises.stat(filePath);
  if (expected && (before.size !== expected.size || before.mtimeMs !== expected.mtimeMs)) throw new Error('O arquivo mudou antes da verificação de integridade.');
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  const after = await fs.promises.stat(filePath);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('O arquivo mudou durante a verificação de integridade.');
  return hash.digest('hex');
});
ipcMain.handle('save-start', async (_e, name, autoReceive) => {
  const safe = String(name || 'arquivo').replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').slice(0, 180) || 'arquivo';
  const c = await readConfig();
  let chosen;
  if (autoReceive && c.receiveFolder) {
    await fs.promises.mkdir(c.receiveFolder, { recursive: true });
    const ext = path.extname(safe), base = path.basename(safe, ext);
    chosen = path.join(c.receiveFolder, safe);
    let i = 1;
    while (fs.existsSync(chosen)) chosen = path.join(c.receiveFolder, base + ' (' + i++ + ')' + ext);
  } else {
    const r = await dialog.showSaveDialog(win, { defaultPath: safe, buttonLabel: 'Salvar arquivo' });
    if (r.canceled || !r.filePath) return null;
    chosen = r.filePath;
    if (fs.existsSync(chosen)) {
      const ext = path.extname(chosen), base = path.basename(chosen, ext), dir = path.dirname(chosen);
      let i = 1; while (fs.existsSync(chosen)) chosen = path.join(dir, base + ' (' + i++ + ')' + ext);
    }
  }
  const tempPath = chosen + '.transferlab-' + crypto.randomUUID() + '.part';
  await fs.promises.writeFile(tempPath, Buffer.alloc(0), { flag: 'wx' });
  return { id: crypto.randomUUID(), path: tempPath, finalPath: chosen };
});
ipcMain.handle('save-chunk', async (_e, filePath, buffer, position) => {
  const fd = await fs.promises.open(filePath, 'r+');
  try { const data = Buffer.from(buffer); let written = 0; while (written < data.length) { const result = await fd.write(data, written, data.length - written, position + written); if (!result.bytesWritten) throw new Error('A gravação do bloco foi interrompida.'); written += result.bytesWritten; } }
  finally { await fd.close(); }
  return true;
});
ipcMain.handle('save-finish', async (_e, filePath, finalPath, expectedSize, expectedHash) => {
  const stat = await fs.promises.stat(filePath);
  if (stat.size !== expectedSize) return { ok: false, size: stat.size, reason: 'size-mismatch' };
  if (expectedHash) {
    const hash = crypto.createHash('sha256');
    await new Promise((resolve, reject) => { const stream = fs.createReadStream(filePath); stream.on('data', chunk => hash.update(chunk)); stream.on('error', reject); stream.on('end', resolve); });
    const actualHash = hash.digest('hex');
    if (actualHash !== expectedHash) return { ok: false, size: stat.size, reason: 'sha256-mismatch' };
  }
  let destination = finalPath;
  if (fs.existsSync(destination)) { const ext = path.extname(finalPath), base = path.basename(finalPath, ext), dir = path.dirname(finalPath); let i = 1; while (fs.existsSync(destination)) destination = path.join(dir, base + ' (' + i++ + ')' + ext); }
  await fs.promises.rename(filePath, destination);
  return { ok: true, size: stat.size, path: destination };
});
ipcMain.handle('save-abort', async (_e, filePath) => { try { await fs.promises.unlink(filePath); return true; } catch { return false; } });
ipcMain.handle('open-path', async (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('diagnostic-self-test', async () => {
  const result = { tempWriteReadDelete: false, logWritable: false, userDataWritable: false };
  const testPath = path.join(app.getPath('temp'), 'transferlab-test-' + crypto.randomUUID() + '.tmp');
  try { const payload = crypto.randomBytes(128); await fs.promises.writeFile(testPath, payload); result.tempWriteReadDelete = payload.equals(await fs.promises.readFile(testPath)); }
  catch (e) { result.tempError = e.message; } finally { try { await fs.promises.unlink(testPath); } catch {} }
  try { await fs.promises.mkdir(app.getPath('userData'), { recursive: true }); await fs.promises.access(app.getPath('userData'), fs.constants.W_OK); result.userDataWritable = true; } catch (e) { result.userDataError = e.message; }
  try { await appendLog({ level: 'info', event: 'diagnostic-self-test' }); result.logWritable = true; } catch (e) { result.logError = e.message; }
  return { ...result, appVersion: app.getVersion(), platform: process.platform, arch: process.arch, freeMemory: os.freemem(), totalMemory: os.totalmem(), background: { trayActive: !!tray, folderWatcherActive: !!watcher, folderRescanActive: !!watcherPoll, autoStartEnabled: !!app.getLoginItemSettings().openAtLogin } };
});
ipcMain.handle('diagnostic-read-logs', async () => { try { return (await fs.promises.readFile(logFile(), 'utf8')).trim().split('\n').filter(Boolean).slice(-500).map(line => { try { return JSON.parse(line); } catch { return { raw: line }; } }); } catch { return []; } });
ipcMain.handle('diagnostic-log', async (_e, entry) => { try { await appendLog({ level: entry.level || 'info', event: String(entry.event || 'client-log').slice(0, 120), details: entry.details || null }); return true; } catch { return false; } });
ipcMain.handle('export-diagnostic-report', async (_e, report) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = await dialog.showSaveDialog(win, { defaultPath: 'TransferLab-diagnostico-' + stamp + '.json', filters: [{ name: 'Relatório JSON', extensions: ['json'] }] });
  if (target.canceled || !target.filePath) return { canceled: true };
  const logs = await readLogs();
  await fs.promises.writeFile(target.filePath, JSON.stringify({ ...report, logs }, null, 2), 'utf8');
  return { canceled: false, path: target.filePath };
});
