const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

let win;
let watcher = null;
const configPath = () => path.join(app.getPath('userData'), 'settings.json');
const logFile = () => path.join(app.getPath('userData'), 'logs', 'transferlab.log');
const defaults = { deviceId: crypto.randomUUID(), trustedDevices: [], receiveFolder: path.join(app.getPath('downloads'), 'TransferLab'), monitorFolder: '', autoTargetPeerId: '', autoStart: false };
async function readConfig() {
  try { return { ...defaults, ...JSON.parse(await fs.promises.readFile(configPath(), 'utf8')) }; }
  catch { return { ...defaults }; }
}
async function writeConfig(patch) {
  const current = await readConfig();
  const next = { ...current, ...patch };
  await fs.promises.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.promises.writeFile(configPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}
async function appendLog(entry) {
  const file = logFile();
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.appendFile(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8');
}
function createWindow() {
  win = new BrowserWindow({ width: 1180, height: 820, minWidth: 900, minHeight: 640, backgroundColor: '#ffffff', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());
}
app.whenReady().then(async () => {
  const cfg = await readConfig();
  app.setLoginItemSettings({ openAtLogin: !!cfg.autoStart });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('device-info', async () => { const c = await readConfig(); return { name: os.hostname(), id: c.deviceId, version: app.getVersion(), platform: process.platform, arch: process.arch }; });
ipcMain.handle('get-settings', async () => { const c = await readConfig(); return { ...c, trustedDevices: c.trustedDevices || [] }; });
ipcMain.handle('save-settings', async (_e, patch) => {
  const allowed = {};
  for (const key of ['receiveFolder', 'monitorFolder', 'autoTargetPeerId', 'autoStart']) if (patch && Object.prototype.hasOwnProperty.call(patch, key)) allowed[key] = patch[key];
  const c = await writeConfig(allowed);
  app.setLoginItemSettings({ openAtLogin: !!c.autoStart });
  return c;
});
ipcMain.handle('trust-device', async (_e, device) => {
  if (!device || typeof device.id !== 'string' || !device.id || device.id.length > 100) throw new Error('Identificação inválida.');
  const c = await readConfig();
  const list = (c.trustedDevices || []).filter(x => x.id !== device.id);
  list.push({ id: device.id, name: String(device.name || 'Dispositivo').slice(0, 100), addedAt: new Date().toISOString() });
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
  if (!c.monitorFolder) return { ok: false, reason: 'Pasta monitorada não configurada.' };
  await fs.promises.access(c.monitorFolder, fs.constants.R_OK);
  watcher = fs.watch(c.monitorFolder, { persistent: true }, async (_event, filename) => {
    if (!filename) return;
    const full = path.join(c.monitorFolder, filename.toString());
    try {
      const stat = await fs.promises.stat(full);
      if (!stat.isFile()) return;
      let previous = -1, stable = 0;
      for (let i = 0; i < 90 && stable < 4; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const current = await fs.promises.stat(full);
        if (!current.isFile()) return;
        if (current.size === previous && current.size > 0) stable++; else stable = 0;
        previous = current.size;
      }
      if (stable < 4) { await appendLog({ level: 'warning', event: 'monitored-file-never-stabilized', details: { file: path.basename(full) } }); return; }
      const handle = await fs.promises.open(full, 'r');
      await handle.close();
      if (win && !win.isDestroyed()) win.webContents.send('folder-file-ready', { path: full, name: path.basename(full), size: (await fs.promises.stat(full)).size });
      await appendLog({ level: 'info', event: 'monitored-file-ready', details: { file: path.basename(full) } });
    } catch (e) { await appendLog({ level: 'warning', event: 'folder-watch-file-error', details: { file: path.basename(full), message: e.message } }); }
  });
  return { ok: true };
});
ipcMain.handle('pick-files', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return [];
  return r.filePaths.map(p => ({ path: p, name: path.basename(p), size: fs.statSync(p).size }));
});
ipcMain.handle('read-chunk', async (_e, filePath, offset, length) => {
  const fd = await fs.promises.open(filePath, 'r');
  try { const b = Buffer.alloc(length); const { bytesRead } = await fd.read(b, 0, length, offset); return b.subarray(0, bytesRead); }
  finally { await fd.close(); }
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
  try { await fd.write(Buffer.from(buffer), 0, buffer.byteLength, position); }
  finally { await fd.close(); }
  return true;
});
ipcMain.handle('save-finish', async (_e, filePath, finalPath, expectedSize) => {
  const stat = await fs.promises.stat(filePath);
  if (stat.size !== expectedSize) return { ok: false, size: stat.size };
  await fs.promises.rename(filePath, finalPath);
  return { ok: true, size: stat.size, path: finalPath };
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
  return { ...result, appVersion: app.getVersion(), platform: process.platform, arch: process.arch, freeMemory: os.freemem(), totalMemory: os.totalmem() };
});
ipcMain.handle('diagnostic-read-logs', async () => { try { return (await fs.promises.readFile(logFile(), 'utf8')).trim().split('\n').filter(Boolean).slice(-500).map(line => { try { return JSON.parse(line); } catch { return { raw: line }; } }); } catch { return []; } });
ipcMain.handle('diagnostic-log', async (_e, entry) => { try { await appendLog({ level: entry.level || 'info', event: String(entry.event || 'client-log').slice(0, 120), details: entry.details || null }); return true; } catch { return false; } });
ipcMain.handle('export-diagnostic-report', async (_e, report) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = await dialog.showSaveDialog(win, { defaultPath: 'TransferLab-diagnostico-' + stamp + '.json', filters: [{ name: 'Relatório JSON', extensions: ['json'] }] });
  if (target.canceled || !target.filePath) return { canceled: true };
  const logs = await ipcMain.handlers?.get?.('diagnostic-read-logs')?.() || [];
  await fs.promises.writeFile(target.filePath, JSON.stringify({ ...report, logs }, null, 2), 'utf8');
  return { canceled: false, path: target.filePath };
});
