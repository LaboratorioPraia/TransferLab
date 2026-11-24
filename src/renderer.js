// PeerJS JSON serialization expands binary data to Base64. Keep each payload
// comfortably below the DataChannel/PeerJS JSON message limit.
const CHUNK = 8 * 1024;
window.transferProtocolInfo = { version: 4, chunkBytes: CHUNK, encoding: 'base64-json', acknowledgedChunks: true };
const PEER_OPTIONS = { host: '0.peerjs.com', port: 443, path: '/', secure: true, debug: 1, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] } };
let peer=null, conn=null, files=[], incoming=null, deviceInfo=null, settings=null, remoteDevice=null, remoteAuthenticated=false;
let transfers=0, receiveQueue=Promise.resolve(), autoQueue=Promise.resolve(), reconnectTimer=null;
const pendingAccept=new Map(), pendingComplete=new Map(), pendingChunk=new Map(), expectedSizes=new Map(), rejectionReasons=new Map();
const $=id=>document.getElementById(id);
const log=(level,event,details={})=>window.transferAPI.diagnosticLog({level,event,details}).catch(()=>false);
const toast=message=>{const el=$('toast');if(!el)return;el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),4500);};
function fmt(n){if(n<1024)return n+' B';const u=['KB','MB','GB','TB'];let i=-1;do{n/=1024;i++;}while(n>=1024&&i<u.length-1);return n.toFixed(1)+' '+u[i];}
function row(name,size,direction){const el=document.createElement('div');el.className='transferrow';el.innerHTML='<div class="fileicon">'+(direction==='send'?'↑':'↓')+'</div><div class="filemeta"><b></b><small></small><div class="bar"><i></i></div></div><span class="percent">0%</span>';el.querySelector('b').textContent=name;el.querySelector('small').textContent=fmt(size)+' · '+(direction==='send'?'Aguardando confirmação':'Recebendo');const host=$('activityList');host.classList.remove('empty');if(host.querySelector('.empty'))host.innerHTML='';host.appendChild(el);transfers++;$('transferCount').textContent=transfers+' itens';return{bar:el.querySelector('.bar i'),pct:el.querySelector('.percent'),meta:el.querySelector('small')};}
function setConnected(ok){$('peerStatus').textContent=ok?'Conectado ao outro dispositivo':'Aguardando conexão';$('connectionState').textContent=ok?'Canal conectado':(peer?.open?'Disponível para conectar':'Identificador local disponível');$('sendBtn').disabled=!(ok&&files.length);$('trustCurrentBtn').disabled=!(ok&&remoteDevice);}
function encodeBase64(value){const b=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer||value,value.byteOffset||0,value.byteLength);let s='';for(let i=0;i<b.length;i+=0x6000)s+=String.fromCharCode(...b.subarray(i,i+0x6000));return btoa(s);}
function decodeBase64(value){const s=atob(value),b=new Uint8Array(s.length);for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return b.buffer;}
function waitFor(map,id,timeout=45000){return new Promise(resolve=>{const timer=setTimeout(()=>{map.delete(id);resolve(false);},timeout);map.set(id,value=>{clearTimeout(timer);map.delete(id);resolve(value);});});}
function resolvePending(map,key,value){const fn=map.get(key);if(fn)fn(value);}
function rejectPending(reason){for(const map of [pendingAccept,pendingComplete,pendingChunk]){for(const resolve of map.values())resolve(false);map.clear();}expectedSizes.clear();if(reason)toast(reason);}
function safeSend(connection,message){if(!connection||!connection.open)throw new Error('Canal de dados fechado.');connection.send(message);}
function sendHello(connection){try{safeSend(connection,{type:'hello',protocol:4,device:{id:deviceInfo.id,name:deviceInfo.name,version:deviceInfo.version}});}catch(e){log('warning','hello-send-failed',{message:e.message});}}
async function init(){
 try{
  deviceInfo=await window.transferAPI.deviceInfo();settings=await window.transferAPI.getSettings();
  $('deviceName').textContent=deviceInfo.name;
  $('myId').textContent=deviceInfo.id;
  $('connectionState').textContent='Código permanente carregado; conectando ao serviço…';
  await populateSettings();
  await renderHistory();
  await checkForUpdates(false);
  setInterval(()=>checkForUpdates(false),6*60*60*1000);
  peer=new Peer(deviceInfo.id,PEER_OPTIONS);window.transferPeer=peer;
  peer.on('open',id=>{$('myId').textContent=id;$('connectionState').textContent='Disponível para conectar';log('info','peer-open',{peerId:id});});
  peer.on('connection',connection=>{if(conn&&(conn.open||conn.opening)){connection.close();log('warning','incoming-connection-rejected',{reason:'busy'});return;}attach(connection);});
  peer.on('error',error=>{console.error(error);$('connectionState').textContent='Falha no serviço: '+(error.type||'erro');log('error','peerjs-error',{type:error.type||null,message:error.message||String(error)});toast('Falha na sinalização: '+(error.type||error.message||'erro'));});
  peer.on('disconnected',()=>{$('connectionState').textContent='Sinalização desconectada; tentando reconectar…';log('warning','peer-disconnected',{});if(peer&&!peer.destroyed&&!reconnectTimer)reconnectTimer=setTimeout(()=>{reconnectTimer=null;try{peer.reconnect();}catch(e){log('error','peer-reconnect-failed',{message:e.message});}},2500);});
  peer.on('close',()=>{$('connectionState').textContent='Serviço de conexão encerrado';log('error','peer-closed',{});});
  setTimeout(()=>{if(peer&&!peer.open&&!peer.destroyed){$('connectionState').textContent='Servidor não respondeu. Código permanente preservado; verifique internet/firewall.';log('warning','peer-open-timeout',{peerId:deviceInfo.id,server:'0.peerjs.com'});}},15000);
  window.transferAPI.onFolderFileReady(file=>{autoQueue=autoQueue.then(()=>autoSendFileNow(file)).catch(e=>log('error','auto-queue-failed',{message:e.message}));});
  const watch=await window.transferAPI.startFolderWatch().catch(e=>({ok:false,reason:e.message}));
  if(!watch.ok&&settings.monitorFolder)log('warning','folder-watch-not-started',{reason:watch.reason||'unknown'});
 }catch(e){console.error(e);$('connectionState').textContent='Falha ao iniciar aplicativo';toast('Não foi possível iniciar: '+e.message);log('error','startup-failed',{message:e.message,stack:e.stack});}
}
function attach(connection){
 conn=connection;remoteDevice=null;remoteAuthenticated=false;window.transferConnection=connection;setConnected(false);
 let opened=false;
 const onOpen=()=>{if(opened||conn!==connection)return;opened=true;setConnected(true);sendHello(connection);log('info','data-channel-open',{peer:connection.peer,serialization:'json'});toast('Canal de dados aberto. Identificando dispositivo…');};
 connection.on('open',onOpen);
 if(connection.open)setTimeout(onOpen,0);
 connection.on('data',data=>{receiveQueue=receiveQueue.then(()=>handleData(data,connection)).catch(async e=>{console.error(e);await log('error','receive-handler-failed',{message:e.message,stack:e.stack});try{safeSend(connection,{type:'file-reject',id:incoming?.id||data?.id,reason:'receiver-error'});}catch{}if(incoming&&conn===connection){const current=incoming;await window.transferAPI.saveAbort(current.path);await saveTransferHistory({direction:'receive',status:'failed',name:current.name,size:current.size,remoteDeviceId:remoteDevice?.id||null,error:e.message,technical:e.stack||e.message});window.transferAPI.transferDialog({direction:'receive',name:current.name,detail:fmt(current.size),percent:0,status:e.message||'Erro no recebimento',failed:true}).catch(()=>{});incoming=null;}toast('Erro no recebimento: '+e.message);});});
 connection.on('close',()=>{log('warning','data-channel-closed',{peer:connection.peer});if(conn===connection){conn=null;remoteDevice=null;remoteAuthenticated=false;setConnected(false);}if(incoming){window.transferAPI.saveAbort(incoming.path);incoming=null;}rejectPending('A conexão foi encerrada.');});
 connection.on('error',error=>{console.error(error);log('error','data-connection-error',{message:error.message||String(error),peer:connection.peer});toast('Erro no canal de transferência.');});
}
$('connectBtn').onclick=()=>{const id=$('remoteId').value.trim();if(!id)return toast('Informe o código permanente do destino.');if(!peer?.open)return toast('Servidor de sinalização ainda não está disponível. O código local continua válido.');if(id===deviceInfo.id)return toast('Este é o código deste computador.');if(conn&&(conn.open||conn.opening))return toast('Já existe uma conexão em andamento.');try{$('connectionState').textContent='Chamando dispositivo…';attach(peer.connect(id,{reliable:true,serialization:'json'}));log('info','outgoing-connection-started',{targetPeerId:id});}catch(e){log('error','connect-start-failed',{message:e.message});toast('Não foi possível conectar: '+e.message);}};
$('chooseFiles').onclick=async()=>{files=await window.transferAPI.pickFiles();renderFiles();};
function renderFiles(){$('selectedFiles').textContent=files.length?files.map(f=>f.name+' ('+fmt(f.size)+')').join(' · '):'';$('sendBtn').disabled=!(conn?.open&&remoteDevice&&files.length);}
$('sendBtn').onclick=async()=>{if(!conn?.open||!remoteDevice)return toast('Conecte e aguarde a identificação do outro dispositivo.');$('sendBtn').disabled=true;try{for(const file of files)await sendFile(file,conn);files=[];renderFiles();}catch(e){console.error(e);await log('error','transfer-failed',{message:e.message,stack:e.stack});toast('Transferência interrompida: '+e.message);}finally{renderFiles();}};
async function sendFile(file,connection){
 if(!connection?.open||connection!==conn)throw new Error('Conexão indisponível.');
 const id=crypto.randomUUID(),ui=row(file.name,file.size,'send');
 expectedSizes.set(id,file.size);
 window.transferAPI.transferDialog({direction:'send',name:file.name,detail:fmt(file.size),percent:0,status:'Verificando arquivo'}).catch(()=>{});
 try{
  const sha256=await window.transferAPI.hashFile(file.path,{size:file.size,mtimeMs:file.mtimeMs});
  const accepted=waitFor(pendingAccept,id,90000);
  safeSend(connection,{type:'file-start',protocol:4,id,name:file.name,size:file.size});
  if(!(await accepted)){const reason=rejectionReasons.get(id);rejectionReasons.delete(id);throw new Error(reason?'O receptor recusou o arquivo: '+reason:'O receptor não confirmou o início do arquivo em 90 segundos.');}
  let offset=0;
  while(offset<file.size){
   if(!connection.open||connection!==conn)throw new Error('Conexão perdida durante o envio.');
   const length=Math.min(CHUNK,file.size-offset);
   const chunk=await window.transferAPI.readChunk(file.path,offset,length,{size:file.size,mtimeMs:file.mtimeMs});
   if(!chunk?.byteLength)throw new Error('Falha ao ler arquivo de origem em '+offset+' bytes.');
   const key=id+':'+offset,ack=waitFor(pendingChunk,key,45000);
   safeSend(connection,{type:'file-chunk',protocol:4,id,offset,data:encodeBase64(chunk)});
   if(!(await ack))throw new Error('O receptor não confirmou o bloco iniciado em '+offset+' bytes.');
   offset+=chunk.byteLength;
   const pct=file.size?Math.floor(offset/file.size*100):100;
   ui.bar.style.width=pct+'%';ui.pct.textContent=pct+'%';ui.meta.textContent=fmt(file.size)+' · Blocos gravados e confirmados';window.transferAPI.transferDialog({direction:'send',name:file.name,detail:fmt(file.size),percent:pct,status:'Enviando com verificação de integridade'}).catch(()=>{});
  }
  const completed=waitFor(pendingComplete,id,90000);
  safeSend(connection,{type:'file-end',protocol:4,id,sha256});
  if(!(await completed))throw new Error('O receptor não confirmou a gravação final; arquivo não será considerado enviado.');
  ui.bar.style.width='100%';ui.pct.textContent='100%';ui.meta.textContent=fmt(file.size)+' · Recebimento confirmado pelo destino';window.transferAPI.transferDialog({direction:'send',name:file.name,detail:fmt(file.size),percent:100,status:'Enviado e validado',done:true}).catch(()=>{});
  await log('info','transfer-sent-confirmed',{name:file.name,size:file.size,remoteDeviceId:remoteDevice?.id||null});
  await saveTransferHistory({direction:'send',status:'success',name:file.name,size:file.size,sourcePath:file.path,remoteDeviceId:remoteDevice?.id||null});
 }catch(error){
  if(connection?.open){try{safeSend(connection,{type:'file-abort',protocol:4,id,reason:String(error.message||error).slice(0,300)});}catch{}}
  ui.pct.textContent='Falha';ui.meta.textContent=fmt(file.size)+' · Envio interrompido';await saveTransferHistory({direction:'send',status:'failed',name:file.name,size:file.size,sourcePath:file.path,remoteDeviceId:remoteDevice?.id||null,error:error.message,technical:error.stack||error.message});window.transferAPI.transferDialog({direction:'send',name:file.name,detail:fmt(file.size),percent:0,status:error.message||'Falha no envio',failed:true}).catch(()=>{});
  throw error;
 }finally{
  expectedSizes.delete(id);rejectionReasons.delete(id);
  for(const map of [pendingAccept,pendingComplete]){const resolve=map.get(id);if(resolve)resolve(false);}
  for(const [key,resolve] of pendingChunk){if(key.startsWith(id+':'))resolve(false);}
 }
}
async function handleData(data,connection){
 if(!data||typeof data!=='object')return;
 if(data.type==='hello'){
  if(data.device&&typeof data.device.id==='string'){
   remoteDevice={id:data.device.id,name:String(data.device.name||'Dispositivo'),version:data.device.version||null,protocol:data.protocol||null};
   $('remoteDeviceLabel').textContent=remoteDevice.name+' · '+remoteDevice.id;
   $('trustCurrentBtn').disabled=false;
   safeSend(connection,{type:'hello-ack',protocol:4,deviceId:deviceInfo.id});
   const token=settings?.peerTokens?.[remoteDevice.id];if(token)safeSend(connection,{type:'auth',protocol:4,deviceId:deviceInfo.id,token});
   renderFiles();setConnected(!!connection.open);log('info','remote-device-identified',{deviceId:remoteDevice.id,name:remoteDevice.name,protocol:data.protocol||null});
  }return;
 }
 if(data.type==='hello-ack'){log('info','remote-hello-ack',{deviceId:data.deviceId||null});return;}
 if(data.type==='auth'){
  const trusted=(settings?.trustedDevices||[]).find(item=>item.id===remoteDevice?.id);
  remoteAuthenticated=!!trusted?.token&&trusted.token===data.token&&data.deviceId===remoteDevice?.id;
  await log(remoteAuthenticated?'info':'warning',remoteAuthenticated?'trusted-device-authenticated':'trusted-device-auth-failed',{deviceId:remoteDevice?.id||null});
  return;
 }
 if(data.type==='trust-grant'){
  if(typeof data.receiverId==='string'&&typeof data.token==='string'){await window.transferAPI.storePeerToken(data.receiverId,data.token);settings=await window.transferAPI.getSettings();toast('Autorização segura salva para o destino.');}
  return;
 }
 if(data.type==='file-abort'){
  if(incoming&&data.id===incoming.id){const current=incoming;incoming=null;await window.transferAPI.saveAbort(current.path);current.ui.pct.textContent='Cancelado';current.ui.meta.textContent=fmt(current.size)+' · Remetente interrompeu o envio';window.transferAPI.transferDialog({direction:'receive',name:current.name,detail:fmt(current.size),percent:0,status:'Envio cancelado pelo remetente',failed:true}).catch(()=>{});await log('warning','transfer-aborted-by-sender',{name:current.name,reason:data.reason||'unknown'});await saveTransferHistory({direction:'receive',status:'failed',name:current.name,size:current.size,remoteDeviceId:remoteDevice?.id||null,error:'O remetente interrompeu a transferência.',technical:String(data.reason||'unknown')});}
  return;
 }
 if(data.type==='file-start'){
  if(incoming){safeSend(connection,{type:'file-reject',id:data.id,reason:'busy'});return;}
  if(typeof data.id!=='string'||typeof data.name!=='string'||!Number.isSafeInteger(data.size)||data.size<0||data.size>Number.MAX_SAFE_INTEGER){safeSend(connection,{type:'file-reject',id:data.id,reason:'invalid-metadata'});return;}
  const trusted=!!remoteAuthenticated&&(settings?.trustedDevices||[]).some(item=>item.id===remoteDevice?.id);
  const target=await window.transferAPI.saveStart(data.name,trusted);
  if(!target){safeSend(connection,{type:'file-reject',id:data.id,reason:'cancelled'});toast('Recebimento cancelado.');return;}
  incoming={id:data.id,name:data.name,size:data.size,path:target.path,finalPath:target.finalPath,received:0,ui:row(data.name,data.size,'receive')};
  window.transferAPI.transferDialog({direction:'receive',name:data.name,detail:fmt(data.size),percent:0,status:'Recebendo arquivo'}).catch(()=>{});
  safeSend(connection,{type:'file-accept',id:data.id});await log('info','transfer-accepted',{name:data.name,size:data.size,autoReceive:trusted});return;
 }
 if(data.type==='file-accept'){resolvePending(pendingAccept,data.id,true);return;}
 if(data.type==='file-reject'){
  expectedSizes.delete(data.id);resolvePending(pendingAccept,data.id,false);resolvePending(pendingComplete,data.id,false);
  for(const [key] of pendingChunk)if(key.startsWith(data.id+':'))resolvePending(pendingChunk,key,false);
  rejectionReasons.set(data.id,String(data.reason||'unknown'));await log('warning','remote-rejected-transfer',{id:data.id,reason:data.reason||'unknown'});return;
 }
 if(data.type==='file-chunk'){
  if(!incoming||data.id!==incoming.id||typeof data.data!=='string'){safeSend(connection,{type:'file-chunk-ack',id:data.id,offset:data.offset,ok:false});return;}
  const buffer=decodeBase64(data.data);
  if(data.offset!==incoming.received||incoming.received+buffer.byteLength>incoming.size){safeSend(connection,{type:'file-chunk-ack',id:data.id,offset:data.offset,ok:false});throw new Error('Bloco fora de ordem ou tamanho inválido.');}
  await window.transferAPI.saveChunk(incoming.path,buffer,data.offset);incoming.received+=buffer.byteLength;
  const pct=incoming.size?Math.floor(incoming.received/incoming.size*100):100;incoming.ui.bar.style.width=pct+'%';incoming.ui.pct.textContent=pct+'%';incoming.ui.meta.textContent=fmt(incoming.size)+' · Gravado no disco';window.transferAPI.transferDialog({direction:'receive',name:incoming.name,detail:fmt(incoming.size),percent:pct,status:'Recebendo e gravando'}).catch(()=>{});
  safeSend(connection,{type:'file-chunk-ack',id:data.id,offset:data.offset,ok:true,received:incoming.received});return;
 }
 if(data.type==='file-chunk-ack'){resolvePending(pendingChunk,data.id+':'+data.offset,!!data.ok);return;}
 if(data.type==='file-end'){
  if(!incoming||data.id!==incoming.id)return;const current=incoming;
  if(current.received!==current.size){safeSend(connection,{type:'file-reject',id:current.id,reason:'size-mismatch'});await window.transferAPI.saveAbort(current.path);current.ui.pct.textContent='Falha';await saveTransferHistory({direction:'receive',status:'failed',name:current.name,size:current.size,error:'size-mismatch',technical:'O tamanho recebido não corresponde ao tamanho anunciado pelo remetente.'});incoming=null;return;}
  const result=await window.transferAPI.saveFinish(current.path,current.finalPath,current.size,data.sha256);
  if(result.ok&&result.size===current.size){current.ui.bar.style.width='100%';current.ui.pct.textContent='100%';current.ui.meta.textContent=fmt(result.size)+' · Recebido e validado (SHA-256)';window.transferAPI.transferDialog({direction:'receive',name:current.name,detail:fmt(result.size),percent:100,status:'Recebido e validado',done:true}).catch(()=>{});safeSend(connection,{type:'file-complete',id:current.id,size:result.size});toast('Arquivo recebido e confirmado: '+current.name);await window.transferAPI.diagnosticLog({level:'info',event:'transfer-received-confirmed',details:{name:current.name,size:result.size,path:result.path}});await saveTransferHistory({direction:'receive',status:'success',name:current.name,size:result.size,remoteDeviceId:remoteDevice?.id||null});}
  else{await window.transferAPI.saveAbort(current.path);safeSend(connection,{type:'file-reject',id:current.id,reason:result.reason||'write-failed'});current.ui.pct.textContent='Falha';await saveTransferHistory({direction:'receive',status:'failed',name:current.name,size:current.size,error:result.reason||'write-failed',technical:'Falha ao validar o arquivo recebido.'});window.transferAPI.transferDialog({direction:'receive',name:current.name,detail:fmt(current.size),percent:0,status:'Falha na validação do arquivo',failed:true}).catch(()=>{});}
  incoming=null;return;
 }
 if(data.type==='file-complete'){const expected=expectedSizes.get(data.id);expectedSizes.delete(data.id);resolvePending(pendingComplete,data.id,Number(data.size)===expected);return;}
}
async function waitForRemote(targetId,timeout=45000){
 const started=Date.now();while(Date.now()-started<timeout){if(conn?.open&&remoteDevice?.id===targetId)return true;if(conn&&(conn.open||conn.opening)&&remoteDevice&&remoteDevice.id!==targetId)throw new Error('Outro dispositivo está conectado.');await new Promise(resolve=>setTimeout(resolve,250));}throw new Error('O destino não concluiu a identificação dentro do prazo.');
}
function explainTransferError(message) {
 const value=String(message||'Falha desconhecida');
 if(/receptor recusou.*busy/i.test(value))return 'O computador de destino está ocupado recebendo outro arquivo. Aguarde e tente novamente.';
 if(/receptor recusou.*cancelled/i.test(value))return 'O recebimento foi cancelado no computador de destino. Verifique a confirmação de recebimento.';
 if(/receptor recusou.*invalid-metadata/i.test(value))return 'O destino rejeitou os dados do arquivo. Atualize os dois computadores para a mesma versão.';
 if(/receptor recusou.*size-mismatch/i.test(value))return 'O tamanho do arquivo recebido ficou diferente do original. Tente novamente.';
 if(/receptor recusou.*sha256-mismatch/i.test(value))return 'O arquivo chegou com conteúdo diferente do original. O destino descartou o arquivo por segurança.';
 if(/receptor recusou.*write-failed/i.test(value))return 'O computador de destino não conseguiu gravar o arquivo. Verifique espaço livre e permissões da pasta.';
 if(/90 segundos|confirmou o início/i.test(value))return 'O computador de destino não confirmou o início. Verifique se o TransferLab está aberto e conectado.';
 if(/conexão|canal|connection|peer|sinalização/i.test(value))return 'A conexão entre os computadores foi interrompida ou não ficou disponível.';
 if(/mudou|alterado|estabilidade|origem/i.test(value))return 'O arquivo ainda estava sendo alterado ou mudou durante a leitura. Aguarde a conclusão da gravação e tente novamente.';
 if(/sha-?256|integridade|hash/i.test(value))return 'A verificação de integridade não correspondeu. O arquivo não foi publicado no destino.';
 if(/bloco|bytes|gravação|disco|write/i.test(value))return 'Houve uma falha durante a gravação de um bloco do arquivo.';
 if(/timeout|tempo limite/i.test(value))return 'O tempo de resposta do computador de destino foi excedido.';
 return 'Não foi possível concluir a transferência. Consulte os detalhes técnicos e tente novamente.';
}
async function saveTransferHistory(entry) {
 try { await window.transferAPI.historyRecord(entry); await renderHistory(); }
 catch(error) { await log('error','history-save-failed',{message:error.message}); }
}
async function renderHistory() {
 const host=$('historyList');if(!host)return;
 let items=[];try{items=await window.transferAPI.historyList();}catch(error){host.textContent='Não foi possível carregar o histórico: '+error.message;return;}
 host.innerHTML='';
 if(!items.length){host.className='history-list empty';host.textContent='Nenhuma transferência registrada ainda.';return;}
 host.className='history-list';
 for(const item of items){
  const card=document.createElement('div');card.className='history-item';
  const info=document.createElement('div');const title=document.createElement('b');title.textContent=item.name||'Arquivo';
  const meta=document.createElement('small');meta.textContent=(item.direction==='receive'?'Recebido':'Enviado')+' · '+fmt(item.size||0)+' · '+new Date(item.at).toLocaleString()+(item.retries?' · '+item.retries+' tentativa(s)':'');
  info.append(title,meta);
  const actions=document.createElement('div');actions.className='history-actions';
  const status=document.createElement('span');status.className='history-status '+(item.status==='success'||item.status==='retried'?'success':item.status==='failed'?'failed':'');status.textContent=item.status==='success'?'Concluído':item.status==='retried'?'Reenviado':'Falhou';actions.append(status);
  if(item.direction==='send'&&item.status==='failed'&&item.sourcePath){const retry=document.createElement('button');retry.className='retry-button';retry.textContent='Tentar novamente';retry.onclick=async()=>{retry.disabled=true;retry.textContent='Preparando…';try{const target=item.remoteDeviceId;if(!conn?.open){if(!target)throw new Error('Não há código de destino salvo neste registro. Conecte ao computador novamente.');if(!peer?.open)throw new Error('O serviço de conexão ainda não está disponível.');attach(peer.connect(target,{reliable:true,serialization:'json'}));await waitForRemote(target);}if(!remoteDevice)throw new Error('O computador de destino ainda não foi identificado.');const file=await window.transferAPI.historyRetryFile(item.id);await sendFile(file,conn);await window.transferAPI.historyMarkRetried(item.id);toast('Reenvio concluído.');}catch(error){toast(explainTransferError(error.message));await log('error','manual-retry-failed',{historyId:item.id,message:error.message});}finally{await renderHistory();}};actions.append(retry);}
  card.append(info,actions);
  if(item.status==='failed'&&item.error){const error=document.createElement('div');error.className='history-error';error.textContent=explainTransferError(item.error)+' '+item.error;card.append(error);}
  host.append(card);
 }
}
async function checkForUpdates(showNoUpdate=false) {
 const button=$('updateButton');if(!button)return;
 try{const result=await window.transferAPI.checkForUpdates();button.classList.toggle('available',!!result.available);button.title=result.available?'Atualização '+result.version+' disponível':'Verificar atualizações';
  if(result.available){button.onclick=async()=>{const choice=confirm('TransferLab '+result.version+' está disponível. Baixar e instalar agora?');if(!choice)return;button.disabled=true;try{toast('Baixando atualização e verificando SHA-256…');await window.transferAPI.downloadUpdate(result.assetUrl,result.checksumUrl,result.version);toast('Download verificado. O instalador será aberto.');await window.transferAPI.installUpdate();}catch(error){toast('Não foi possível atualizar: '+error.message);await log('error','update-install-failed',{message:error.message});}finally{button.disabled=false;}};}
  else {button.onclick=async()=>{button.disabled=true;await checkForUpdates(true);button.disabled=false;};if(showNoUpdate&&!result.error)toast('TransferLab atualizado.');}
 }catch(error){await log('warning','update-check-ui-failed',{message:error.message});}
}
async function autoSendFileNow(file){
 let success=false,sendAttempted=false;
 try{
  if(!settings?.monitorFolder||!settings?.autoTargetPeerId)throw new Error('Configure a pasta monitorada e o dispositivo de destino.');
  const target=settings.autoTargetPeerId;
  if(!conn?.open){if(conn&&(conn.open||conn.opening))throw new Error('Há outra conexão em andamento.');if(!peer?.open)throw new Error('Serviço de sinalização indisponível.');attach(peer.connect(target,{reliable:true,serialization:'json'}));}
  await waitForRemote(target);
  if(remoteDevice?.id!==target)throw new Error('O dispositivo conectado não corresponde ao destino configurado.');
  toast('Enviando automaticamente: '+file.name);sendAttempted=true;await sendFile(file,conn);success=true;toast('Envio automático confirmado: '+file.name);
 }catch(e){await log('error','automatic-send-failed',{file:file.name,message:e.message});toast('Envio automático falhou: '+explainTransferError(e.message));if(!sendAttempted)await saveTransferHistory({direction:'send',status:'failed',name:file.name,size:file.size,sourcePath:file.path,remoteDeviceId:settings?.autoTargetPeerId||'',error:e.message,technical:e.stack||e.message});}
 finally{try{await window.transferAPI.folderFileResult(file,success);}catch(e){await log('error','folder-file-ack-failed',{message:e.message});}}
}
$('minimizeWindow').onclick=()=>window.transferAPI.windowControl('minimize');
$('hideWindow').onclick=()=>window.transferAPI.windowControl('hide');
$('refreshHistory').onclick=renderHistory;
$('clearAppData').onclick=async()=>{try{await window.transferAPI.clearAppData();}catch(error){toast('Não foi possível limpar os dados: '+error.message);}};
$('copyId').onclick=async()=>{try{await navigator.clipboard.writeText(deviceInfo?.id||'');toast('Código permanente copiado.');}catch{toast('Não foi possível copiar o código.');}};
$('trustCurrentBtn').onclick=async()=>{if(!remoteDevice||!conn?.open)return;try{settings=await window.transferAPI.getSettings();const token=crypto.randomUUID()+crypto.randomUUID();settings.trustedDevices=await window.transferAPI.trustDevice(remoteDevice,token);remoteAuthenticated=true;safeSend(conn,{type:'trust-grant',receiverId:deviceInfo.id,token});renderTrusted();toast('Dispositivo autorizado para enviar arquivos automaticamente a este computador.');}catch(e){toast('Não foi possível autorizar: '+e.message);await log('error','trust-device-failed',{message:e.message});}};
function renderTrusted(){const host=$('trustedList');if(!host)return;host.innerHTML='';(settings?.trustedDevices||[]).forEach(device=>{const item=document.createElement('div');item.className='setting';const label=document.createElement('b');label.textContent=device.name+' · '+device.id;const btn=document.createElement('button');btn.className='secondary';btn.textContent='Remover';btn.onclick=async()=>{settings.trustedDevices=await window.transferAPI.untrustDevice(device.id);renderTrusted();};item.append(label,btn);host.appendChild(item);});}
async function populateSettings(){settings=await window.transferAPI.getSettings();$('receiveFolder').value=settings.receiveFolder||'';$('monitorFolder').value=settings.monitorFolder||'';$('autoTargetPeerId').value=settings.autoTargetPeerId||'';$('autoStart').checked=settings.autoStart!==false;$('remoteDeviceLabel').textContent='Nenhum dispositivo conectado';renderTrusted();}
$('chooseReceiveFolder').onclick=async()=>{const folder=await window.transferAPI.pickFolder();if(folder){$('receiveFolder').value=folder;await saveFolderSettings();}};
$('chooseMonitorFolder').onclick=async()=>{const folder=await window.transferAPI.pickFolder();if(folder){$('monitorFolder').value=folder;await saveFolderSettings();}};
async function saveFolderSettings(){const patch={receiveFolder:$('receiveFolder').value,monitorFolder:$('monitorFolder').value,autoTargetPeerId:$('autoTargetPeerId').value.trim(),autoStart:$('autoStart').checked};settings=await window.transferAPI.saveSettings(patch);const result=await window.transferAPI.startFolderWatch();toast(result.ok?'Configurações salvas. Monitoramento ativo.':'Configurações salvas. '+(result.reason||'Verifique a pasta.'));}
$('saveAutomation').onclick=saveFolderSettings;
document.querySelectorAll('.nav').forEach(button=>button.onclick=()=>{document.querySelectorAll('.nav').forEach(item=>item.classList.remove('active'));button.classList.add('active');document.querySelectorAll('.tab').forEach(tab=>tab.classList.remove('visible'));$('tab-'+button.dataset.tab).classList.add('visible');$('pageTitle').textContent=({transfer:'Enviar arquivos',devices:'Dispositivos',history:'Histórico',settings:'Configurações'})[button.dataset.tab];});
init();