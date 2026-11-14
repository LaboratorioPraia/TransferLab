const CHUNK = 64 * 1024;
let peer = null, conn = null, files = [], incoming = null, deviceInfo = null, settings = null, remoteDevice = null, remoteAuthenticated = false;
let transfers = 0, receiveQueue = Promise.resolve(), autoSending = false;
const pendingAccept = new Map(), pendingComplete = new Map(), pendingChunk = new Map();
const $ = id => document.getElementById(id);
const toast = message => { const el = $('toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 4000); };
function fmt(n) { if (n < 1024) return n + ' B'; const u=['KB','MB','GB','TB']; let i=-1; do { n/=1024; i++; } while(n>=1024&&i<u.length-1); return n.toFixed(1)+' '+u[i]; }
function row(name,size,direction) {
  const el=document.createElement('div'); el.className='transferrow';
  el.innerHTML='<div class="fileicon">'+(direction==='send'?'↑':'↓')+'</div><div class="filemeta"><b></b><small></small><div class="bar"><i></i></div></div><span class="percent">0%</span>';
  el.querySelector('b').textContent=name; el.querySelector('small').textContent=fmt(size)+' · '+(direction==='send'?'Enviando':'Recebendo');
  $('activityList').classList.remove('empty'); if($('activityList').querySelector('.empty')) $('activityList').innerHTML=''; $('activityList').appendChild(el);
  transfers++; $('transferCount').textContent=transfers+' itens';
  return {bar:el.querySelector('.bar i'),pct:el.querySelector('.percent'),meta:el.querySelector('small')};
}
function setConnected(ok) {
  $('peerStatus').textContent=ok?'Conectado ao outro dispositivo':'Aguardando conexão';
  $('connectionState').textContent=ok?'Conectado':(peer&&peer.open?'Pronto para conectar':'Conectando ao serviço');
  $('sendBtn').disabled=!(ok&&files.length);
  $('trustCurrentBtn').disabled=!(ok&&remoteDevice);
}
function encodeBase64(buffer) { const b=new Uint8Array(buffer); let s=''; for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode(...b.subarray(i,i+0x8000)); return btoa(s); }
function decodeBase64(value) { const s=atob(value),b=new Uint8Array(s.length); for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i); return b.buffer; }
function waitFor(map,id,timeout=30000) { return new Promise(resolve=>{const t=setTimeout(()=>{map.delete(id);resolve(false);},timeout);map.set(id,v=>{clearTimeout(t);map.delete(id);resolve(v);});});}
function rejectPending(message) { for(const m of [pendingAccept,pendingComplete,pendingChunk]){for(const resolve of m.values())resolve(false);m.clear();} if(message)toast(message); }
async function init() {
  try {
    deviceInfo=await window.transferAPI.deviceInfo(); settings=await window.transferAPI.getSettings();
    $('deviceName').textContent=deviceInfo.name; $('myId').textContent='Iniciando...';
    peer=new Peer(deviceInfo.id,{host:'0.peerjs.com',port:443,path:'/',secure:true,debug:0}); window.transferPeer=peer;
    peer.on('open',id=>{$('myId').textContent=id;$('connectionState').textContent='Pronto para conectar';});
    peer.on('connection',c=>{if(conn&&(conn.open||conn.opening)){c.close();return;} attach(c);});
    peer.on('error',e=>{console.error(e);window.transferAPI.diagnosticLog({level:'error',event:'peerjs-error',details:{type:e.type,message:e.message}});$('connectionState').textContent='Falha no serviço de conexão';toast('Falha na conexão: '+(e.type||e.message));});
    peer.on('disconnected',()=>{ $('connectionState').textContent='Reconectando...'; if(peer&&!peer.destroyed)peer.reconnect(); });
    populateSettings(); await window.transferAPI.startFolderWatch().catch(()=>{});
    window.transferAPI.onFolderFileReady(file=>autoSendFile(file));
  } catch(e) { console.error(e);toast('Não foi possível iniciar: '+e.message);window.transferAPI.diagnosticLog({level:'error',event:'startup-failed',details:{message:e.message,stack:e.stack}}); }
}
function attach(connection) {
  conn=connection; remoteDevice=null; remoteAuthenticated=false; window.transferConnection=connection; setConnected(false);
  connection.on('open',()=>{if(conn!==connection)return;setConnected(true);connection.send({type:'hello',device:{id:deviceInfo.id,name:deviceInfo.name}});toast('Conexão estabelecida.');});
  connection.on('data',data=>{receiveQueue=receiveQueue.then(()=>conn===connection?handleData(data):undefined).catch(e=>{console.error(e);window.transferAPI.diagnosticLog({level:'error',event:'receive-handler-failed',details:{message:e.message,stack:e.stack}});toast('Erro ao processar recebimento: '+e.message);});});
  connection.on('close',()=>{if(conn===connection){conn=null;remoteDevice=null;setConnected(false);} if(incoming){window.transferAPI.saveAbort(incoming.path);incoming=null;} rejectPending('A conexão foi encerrada.');});
  connection.on('error',e=>{console.error(e);window.transferAPI.diagnosticLog({level:'error',event:'data-connection-error',details:{message:e.message}});toast('Erro no canal de transferência.');});
}
$('connectBtn').onclick=()=>{const id=$('remoteId').value.trim();if(!id)return toast('Informe o código do dispositivo.');if(!peer?.open)return toast('Serviço de conexão iniciando.');if(id===peer.id)return toast('Este é o código deste computador.');if(conn&&(conn.open||conn.opening))return toast('Já existe uma conexão em andamento.');try{$('connectionState').textContent='Chamando dispositivo...';attach(peer.connect(id,{reliable:true,serialization:'json'}));}catch(e){toast('Não foi possível conectar: '+e.message);}};
$('chooseFiles').onclick=async()=>{files=await window.transferAPI.pickFiles();renderFiles();};
function renderFiles(){$('selectedFiles').textContent=files.length?files.map(f=>f.name+' ('+fmt(f.size)+')').join(' · '):'';$('sendBtn').disabled=!(conn?.open&&files.length);}
$('sendBtn').onclick=async()=>{if(!conn?.open)return toast('Conecte-se ao dispositivo primeiro.');$('sendBtn').disabled=true;try{for(const f of files)await sendFile(f);files=[];renderFiles();}catch(e){console.error(e);window.transferAPI.diagnosticLog({level:'error',event:'transfer-failed',details:{message:e.message,stack:e.stack}});toast('Transferência interrompida: '+e.message);}finally{renderFiles();}};
async function sendFile(file) {
  if(!conn?.open)throw new Error('Conexão indisponível.');
  const id=crypto.randomUUID(),ui=row(file.name,file.size,'send');
  const accepted=waitFor(pendingAccept,id,120000); conn.send({type:'file-start',id,name:file.name,size:file.size});
  if(!(await accepted)){ui.pct.textContent='Não aceito';ui.meta.textContent=fmt(file.size)+' · Não recebido';throw new Error('Destinatário não aceitou ou não respondeu.');}
  let offset=0;
  while(offset<file.size){
    if(!conn?.open)throw new Error('Conexão perdida.');
    const length=Math.min(CHUNK,file.size-offset),chunk=await window.transferAPI.readChunk(file.path,offset,length);
    if(!chunk?.byteLength)throw new Error('Falha ao ler arquivo de origem.');
    const ack=waitFor(pendingChunk,id+':'+offset,60000);
    conn.send({type:'file-chunk',id,offset,data:encodeBase64(chunk)});
    if(!(await ack))throw new Error('Destinatário não confirmou o bloco em '+offset+' bytes.');
    offset+=chunk.byteLength; const pct=Math.floor(offset/file.size*100);ui.bar.style.width=pct+'%';ui.pct.textContent=pct+'%';
  }
  const completed=waitFor(pendingComplete,id,120000);conn.send({type:'file-end',id});
  if(!(await completed))throw new Error('Destinatário não confirmou a gravação final.');
  ui.bar.style.width='100%';ui.pct.textContent='100%';ui.meta.textContent=fmt(file.size)+' · Recebimento confirmado';
  await window.transferAPI.diagnosticLog({level:'info',event:'transfer-sent-confirmed',details:{name:file.name,size:file.size}});
}
async function handleData(data) {
  if(!data||typeof data!=='object')return;
  if(data.type==='hello'){if(data.device&&typeof data.device.id==='string'){remoteDevice={id:data.device.id,name:String(data.device.name||'Dispositivo')};$('trustCurrentBtn').disabled=false;$('remoteDeviceLabel').textContent=remoteDevice.name+' · '+remoteDevice.id;const token=settings?.peerTokens?.[remoteDevice.id];if(token)conn.send({type:'auth',deviceId:deviceInfo.id,token});}return;}
  if(data.type==='auth'){const trusted=(settings?.trustedDevices||[]).find(x=>x.id===remoteDevice?.id);remoteAuthenticated=!!trusted&&!!trusted.token&&trusted.token===data.token&&data.deviceId===remoteDevice.id;if(!remoteAuthenticated)await window.transferAPI.diagnosticLog({level:'warning',event:'trusted-device-auth-failed',details:{deviceId:remoteDevice?.id||null}});return;}
  if(data.type==='trust-grant'){if(typeof data.receiverId==='string'&&typeof data.token==='string'){await window.transferAPI.storePeerToken(data.receiverId,data.token);settings=await window.transferAPI.getSettings();toast('Autorização segura salva para este destinatário.');}return;}
  if(data.type==='file-start'){
    if(incoming){conn.send({type:'file-reject',id:data.id,reason:'busy'});return;}
    if(typeof data.id!=='string'||typeof data.name!=='string'||!Number.isSafeInteger(data.size)||data.size<0){conn.send({type:'file-reject',id:data.id,reason:'invalid'});return;}
    const trusted=!!remoteAuthenticated&&(settings.trustedDevices||[]).some(x=>x.id===remoteDevice?.id);
    const target=await window.transferAPI.saveStart(data.name,trusted);
    if(!target){conn.send({type:'file-reject',id:data.id,reason:'cancelled'});toast('Recebimento cancelado.');return;}
    incoming={id:data.id,name:data.name,size:data.size,path:target.path,finalPath:target.finalPath,received:0,ui:row(data.name,data.size,'receive')};
    conn.send({type:'file-accept',id:data.id});return;
  }
  if(data.type==='file-accept'){pendingAccept.get(data.id)?.(true);return;}
  if(data.type==='file-reject'){pendingAccept.get(data.id)?.(false);toast('Arquivo recusado pelo destinatário.');return;}
  if(data.type==='file-chunk'){
    if(!incoming||data.id!==incoming.id||typeof data.data!=='string'){conn.send({type:'file-chunk-ack',id:data.id,offset:data.offset,ok:false});return;}
    const buffer=decodeBase64(data.data);
    if(data.offset!==incoming.received||incoming.received+buffer.byteLength>incoming.size){conn.send({type:'file-chunk-ack',id:data.id,offset:data.offset,ok:false});throw new Error('Bloco fora de ordem ou tamanho inválido.');}
    await window.transferAPI.saveChunk(incoming.path,buffer,data.offset);incoming.received+=buffer.byteLength;
    const pct=incoming.size?Math.floor(incoming.received/incoming.size*100):100;incoming.ui.bar.style.width=pct+'%';incoming.ui.pct.textContent=pct+'%';
    conn.send({type:'file-chunk-ack',id:data.id,offset:data.offset,ok:true});return;
  }
  if(data.type==='file-chunk-ack'){pendingChunk.get(data.id+':'+data.offset)?.(!!data.ok);return;}
  if(data.type==='file-end'){
    if(!incoming||data.id!==incoming.id)return;const current=incoming;
    if(current.received!==current.size){conn.send({type:'file-reject',id:current.id,reason:'size-mismatch'});await window.transferAPI.saveAbort(current.path);current.ui.pct.textContent='Falha';incoming=null;return;}
    const result=await window.transferAPI.saveFinish(current.path,current.finalPath,current.size);
    if(result.ok&&result.size===current.size){current.ui.bar.style.width='100%';current.ui.pct.textContent='100%';current.ui.meta.textContent=fmt(result.size)+' · Recebido e gravado';conn.send({type:'file-complete',id:current.id,size:result.size});toast('Arquivo recebido: '+current.name);window.transferAPI.openPath(result.path);await window.transferAPI.diagnosticLog({level:'info',event:'transfer-received-confirmed',details:{name:current.name,size:result.size}});}
    else{conn.send({type:'file-reject',id:current.id,reason:'write-failed'});current.ui.pct.textContent='Falha';}
    incoming=null;return;
  }
  if(data.type==='file-complete'){if(data.size>=0)pendingComplete.get(data.id)?.(true);return;}
}
async function autoSendFile(file){
  if(autoSending)return;
  try{
    if(!settings?.monitorFolder||!settings?.autoTargetPeerId)return;
    if(!conn?.open||!remoteDevice||remoteDevice.id!==settings.autoTargetPeerId){
      if(conn&&(conn.open||conn.opening))return;
      if(!peer?.open)return;
      attach(peer.connect(settings.autoTargetPeerId,{reliable:true,serialization:'json'}));
      await new Promise((resolve,reject)=>{const started=Date.now();const t=setInterval(()=>{if(conn?.open&&remoteDevice?.id===settings.autoTargetPeerId){clearInterval(t);resolve();}else if(Date.now()-started>30000){clearInterval(t);reject(new Error('Dispositivo automático não respondeu.'));}},250);});
    }
    if(remoteDevice?.id!==settings.autoTargetPeerId)throw new Error('O dispositivo conectado não corresponde ao destino configurado.');
    autoSending=true;toast('Enviando automaticamente: '+file.name);await sendFile(file);toast('Envio automático concluído: '+file.name);
  }catch(e){await window.transferAPI.diagnosticLog({level:'error',event:'automatic-send-failed',details:{file:file.name,message:e.message}});toast('Envio automático falhou: '+e.message);}finally{autoSending=false;}
}
$('copyId').onclick=async()=>{try{await navigator.clipboard.writeText(peer.id);toast('Código copiado.');}catch{toast('Não foi possível copiar o código.');}};
$('trustCurrentBtn').onclick=async()=>{if(!remoteDevice)return;settings=await window.transferAPI.getSettings();const token=crypto.randomUUID()+crypto.randomUUID();settings.trustedDevices=await window.transferAPI.trustDevice(remoteDevice,token);remoteAuthenticated=true;if(conn?.open)conn.send({type:'trust-grant',receiverId:deviceInfo.id,token});renderTrusted();toast('Dispositivo confiável salvo com chave de autenticação. Próximos arquivos poderão ser recebidos automaticamente.');};
function renderTrusted(){const host=$('trustedList');if(!host)return;host.innerHTML='';(settings?.trustedDevices||[]).forEach(d=>{const row=document.createElement('div');row.className='setting';const label=document.createElement('b');label.textContent=d.name+' · '+d.id;const btn=document.createElement('button');btn.className='secondary';btn.textContent='Remover';btn.onclick=async()=>{settings.trustedDevices=await window.transferAPI.untrustDevice(d.id);renderTrusted();};row.append(label,btn);host.appendChild(row);});}
async function populateSettings(){
  settings=await window.transferAPI.getSettings();
  $('receiveFolder').value=settings.receiveFolder||'';$('monitorFolder').value=settings.monitorFolder||'';$('autoTargetPeerId').value=settings.autoTargetPeerId||'';$('autoStart').checked=!!settings.autoStart;
  $('remoteDeviceLabel').textContent='Nenhum dispositivo conectado';renderTrusted();
}
$('chooseReceiveFolder').onclick=async()=>{const p=await window.transferAPI.pickFolder();if(p){$('receiveFolder').value=p;await saveFolderSettings();}};
$('chooseMonitorFolder').onclick=async()=>{const p=await window.transferAPI.pickFolder();if(p){$('monitorFolder').value=p;await saveFolderSettings();}};
async function saveFolderSettings(){const patch={receiveFolder:$('receiveFolder').value,monitorFolder:$('monitorFolder').value,autoTargetPeerId:$('autoTargetPeerId').value.trim(),autoStart:$('autoStart').checked};settings=await window.transferAPI.saveSettings(patch);const r=await window.transferAPI.startFolderWatch();toast(r.ok?'Configurações salvas. Monitoramento ativo.':'Configurações salvas. '+(r.reason||''));}
$('saveAutomation').onclick=saveFolderSettings;
document.querySelectorAll('.nav').forEach(button=>button.onclick=()=>{document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));button.classList.add('active');document.querySelectorAll('.tab').forEach(x=>x.classList.remove('visible'));$('tab-'+button.dataset.tab).classList.add('visible');$('pageTitle').textContent=({transfer:'Enviar arquivos',devices:'Dispositivos',history:'Histórico',settings:'Configurações'})[button.dataset.tab];});
init();
