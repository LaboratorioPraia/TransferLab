const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

let win;
const logFile = () => path.join(app.getPath('userData'), 'logs', 'transferlab.log');
async function appendLog(entry) {
  const file = logFile();
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.appendFile(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8');
}
function createWindow() {
  win = new BrowserWindow({
    width: 1120, height: 760, minWidth: 900, minHeight: 640,
    backgroundColor: '#ffffff', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());
}
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('device-info', () => ({ name: os.hostname(), id: crypto.randomBytes(5).toString('hex').toUpperCase(), version: app.getVersion(), platform: process.platform, arch: process.arch }));
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
ipcMain.handle('save-start', async (_e, name) => {
  const safe = String(name || 'arquivo').replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').slice(0, 180) || 'arquivo';
  const r = await dialog.showSaveDialog(win, { defaultPath: safe, buttonLabel: 'Salvar arquivo' });
  if (r.canceled || !r.filePath) return null;
  const finalPath = r.filePath;
  let chosen = finalPath;
  if (fs.existsSync(chosen)) {
    const ext = path.extname(finalPath), base = path.basename(finalPath, ext), dir = path.dirname(finalPath);
    let i = 1;
    while (fs.existsSync(chosen)) chosen = path.join(dir, `${base} (${i++})${ext}`);
  }
  await fs.promises.writeFile(chosen, Buffer.alloc(0), { flag: 'wx' });
  return { id: crypto.randomUUID(), path: chosen };
});
ipcMain.handle('save-chunk', async (_e, filePath, buffer, position) => {
  const fd = await fs.promises.open(filePath, 'r+');
  try { await fd.write(Buffer.from(buffer), 0, buffer.byteLength, position); }
  finally { await fd.close(); }
  return true;
});
ipcMain.handle('save-finish', async (_e, filePath) => ({ ok: fs.existsSync(filePath), size: fs.existsSync(filePath) ? (await fs.promises.stat(filePath)).size : 0 }));
ipcMain.handle('open-path', async (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('diagnostic-self-test', async () => {
  const result = { tempWriteReadDelete: false, logWritable: false, userDataWritable: false };
  const testPath = path.join(app.getPath('temp'), `transferlab-test-${crypto.randomUUID()}.tmp`);
  try {
    const payload = crypto.randomBytes(128);
    await fs.promises.writeFile(testPath, payload);
    const read = await fs.promises.readFile(testPath);
    result.tempWriteReadDelete = payload.equals(read);
  } catch (e) { result.tempError = e.message; }
  finally { try { await fs.promises.unlink(testPath); } catch {} }
  try { await fs.promises.mkdir(app.getPath('userData'), { recursive: true }); await fs.promises.access(app.getPath('userData'), fs.constants.W_OK); result.userDataWritable = true; }
  catch (e) { result.userDataError = e.message; }
  try { await appendLog({ level: 'info', event: 'diagnostic-self-test' }); result.logWritable = true; }
  catch (e) { result.logError = e.message; }
  return { ...result, appVersion: app.getVersion(), platform: process.platform, arch: process.arch, freeMemory: os.freemem(), totalMemory: os.totalmem() };
});
ipcMain.handle('diagnostic-read-logs', async () => {
  try {
    const raw = await fs.promises.readFile(logFile(), 'utf8');
    return raw.trim().split('\n').filter(Boolean).slice(-250).map(line => {
      try { return JSON.parse(line); } catch { return { raw: line }; }
    });
  } catch {
    return [];
  }
});
ipcMain.handle('diagnostic-log', async (_e, entry) => {
  try { await appendLog({ level: entry.level || 'info', event: String(entry.event || 'client-log').slice(0, 120), details: entry.details || null }); return true; }
  catch { return false; }
});
ipcMain.handle('export-diagnostic-report', async (_e, report) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = await dialog.showSaveDialog(win, { defaultPath: `TransferLab-diagnostico-${stamp}.json`, filters: [{ name: 'Relatório JSON', extensions: ['json'] }] });
  if (target.canceled || !target.filePath) return { canceled: true };
  await fs.promises.writeFile(target.filePath, JSON.stringify(report, null, 2), 'utf8');
  return { canceled: false, path: target.filePath };
});
