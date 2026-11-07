const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let win;
function createWindow(){
  win = new BrowserWindow({width:1120,height:760,minWidth:900,minHeight:640,backgroundColor:'#ffffff',show:false,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.loadFile(path.join(__dirname,'index.html'));
  win.once('ready-to-show',()=>win.show());
}
app.whenReady().then(()=>{createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});

ipcMain.handle('device-info',()=>({name: require('os').hostname(), id: crypto.randomBytes(5).toString('hex').toUpperCase()}));
ipcMain.handle('pick-files',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile','multiSelections']});if(r.canceled)return [];return r.filePaths.map(p=>({path:p,name:path.basename(p),size:fs.statSync(p).size}));});
ipcMain.handle('read-chunk',async(_e,filePath,offset,length)=>{const fd=await fs.promises.open(filePath,'r');try{const b=Buffer.alloc(length);const {bytesRead}=await fd.read(b,0,length,offset);return b.subarray(0,bytesRead);}finally{await fd.close();}});
ipcMain.handle('save-start',async(_e,name)=>{const safe=String(name||'arquivo').replace(/[\\/:*?"<>|\x00-\x1F]/g,'_').slice(0,180)||'arquivo';const r=await dialog.showSaveDialog(win,{defaultPath:safe,buttonLabel:'Salvar arquivo'});if(r.canceled)return null;const finalPath=r.filePath;let chosen=finalPath;if(fs.existsSync(chosen)){const ext=path.extname(finalPath),base=path.basename(finalPath,ext),dir=path.dirname(finalPath);let i=1;while(fs.existsSync(chosen)){chosen=path.join(dir,`${base} (${i++})${ext}`);}}await fs.promises.writeFile(chosen,Buffer.alloc(0));return {id:crypto.randomUUID(),path:chosen};});
ipcMain.handle('save-chunk',async(_e,filePath,buffer,position)=>{const fd=await fs.promises.open(filePath,'r+');try{await fd.write(Buffer.from(buffer),0,buffer.byteLength,position);}finally{await fd.close();}return true;});
ipcMain.handle('save-finish',async(_e,filePath)=>({ok:fs.existsSync(filePath),size:fs.existsSync(filePath)?(await fs.promises.stat(filePath)).size:0}));
ipcMain.handle('open-path',async(_e,p)=>shell.showItemInFolder(p));
