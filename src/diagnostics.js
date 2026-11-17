(() => {
 const log=async(level,event,details)=>{try{await window.transferAPI.diagnosticLog({level,event,details});}catch{}};
 window.addEventListener('error',event=>log('error','renderer-error',{message:event.message,source:event.filename,line:event.lineno,column:event.colno}));
 window.addEventListener('unhandledrejection',event=>log('error','unhandled-rejection',{reason:String(event.reason?.stack||event.reason||'unknown')}));
 const check=(name,ok,detail)=>({name,status:ok?'OK':'FALHA',ok:!!ok,detail:String(detail||'')});
 let lastReport=null;
 window.runTransferLabDiagnostics=async(peer,connection)=>{
  const checks=[];let device=null,local=null,logs=[];
  checks.push(check('Interface carregada',!!document.getElementById('sendBtn'),'Elementos essenciais da interface.'));
  checks.push(check('API segura do Electron',!!window.transferAPI?.deviceInfo,'Preload e IPC.'));
  checks.push(check('Biblioteca PeerJS',typeof window.Peer==='function',typeof window.Peer));
  const protocol=window.transferProtocolInfo||{};
  const encodedChunkBytes=Math.ceil((protocol.chunkBytes||0)*4/3)+512;
  checks.push(check('Protocolo de transferência em blocos',protocol.version===4&&protocol.chunkBytes>0&&encodedChunkBytes<16*1024,'Protocolo '+(protocol.version||'desconhecido')+' · bloco '+(protocol.chunkBytes||0)+' bytes · carga JSON estimada '+encodedChunkBytes+' bytes · confirmação por bloco '+(protocol.acknowledgedChunks?'ativa':'inativa')));
  checks.push(check('Internet detectada',navigator.onLine,navigator.onLine?'Navegador informa conexão ativa.':'Sem conexão de rede.'));
  checks.push(check('Suporte WebRTC',!!(window.RTCPeerConnection||window.webkitRTCPeerConnection),'API RTCPeerConnection.'));
  checks.push(check('Integridade SHA-256',typeof window.transferAPI?.hashFile==='function','Verificação de integridade antes de concluir o arquivo.'));
  checks.push(check('Janela de progresso',typeof window.transferAPI?.transferDialog==='function','Diálogo independente para envio e recebimento.'));
  checks.push(check('Execução em segundo plano',typeof window.transferAPI?.windowControl==='function','Controles da janela e bandeja do sistema.'));
  try{device=await window.transferAPI.deviceInfo();checks.push(check('UUID permanente',!!device?.id,device?.id||'Não foi possível ler o identificador.'));}catch(e){checks.push(check('UUID permanente',false,e.message));}
  let settings=null;try{settings=await window.transferAPI.getSettings();}catch{}
  try{local=await window.transferAPI.diagnosticSelfTest();checks.push(check('Disco temporário',local.tempWriteReadDelete,local.tempError||'Escrita, leitura e exclusão.'));checks.push(check('Pasta de dados',local.userDataWritable,local.userDataError||'Acesso à pasta de dados.'));checks.push(check('Arquivo de log',local.logWritable,local.logError||'Log gravável.'));checks.push(check('Bandeja do Windows',local.background?.trayActive,local.background?.trayActive?'Ícone de segundo plano ativo.':'Ícone da bandeja não inicializado.'));checks.push(check('Inicialização com Windows',local.background?.autoStartEnabled,local.background?.autoStartEnabled?'Inicialização automática habilitada.':'Inicialização automática desabilitada.'));if(settings?.monitorFolder)checks.push(check('Monitoramento contínuo',local.background?.folderWatcherActive&&local.background?.folderRescanActive,'Watcher: '+!!local.background?.folderWatcherActive+' · Varredura: '+!!local.background?.folderRescanActive));}catch(e){checks.push(check('Testes locais',false,e.message));}
  checks.push(check('Servidor de sinalização PeerJS',!!peer?.open&&!peer?.destroyed,peer?.open?'Sessão registrada: '+(peer.id||'sem ID'):'Não registrado; veja peerjs-error nos logs.'));
  checks.push(check('Conexão remota',!!connection?.open,connection?.open?'Conexão PeerJS aberta.':'Nenhuma conexão aberta.'));
  const channelState=connection?.dataChannel?.readyState||'indisponível';
  checks.push(check('DataChannel WebRTC',channelState==='open','Estado: '+channelState));
  const pc=connection?.peerConnection||connection?._peerConnection||null;
  checks.push(check('Estado ICE',!!pc?.iceConnectionState&&['connected','completed'].includes(pc.iceConnectionState),'Estado ICE: '+(pc?.iceConnectionState||'não exposto pela versão PeerJS/API')));
  try{logs=await window.transferAPI.diagnosticReadLogs();}catch(e){logs=[{level:'error',event:'read-logs-failed',details:e.message}];}
  const failed=checks.filter(item=>!item.ok).length;
  lastReport={product:'TransferLab',version:device?.version||'0.2.0',reportVersion:6,generatedAt:new Date().toISOString(),app:device||{},localTests:local||{},network:{online:navigator.onLine,peerId:peer?.id||null,peerOpen:!!peer?.open,connectionOpen:!!connection?.open,dataChannelState:channelState,iceConnectionState:pc?.iceConnectionState||null,remotePeerId:connection?.peer||null},configuration:{receiveFolderConfigured:!!settings?.receiveFolder,monitorFolderConfigured:!!settings?.monitorFolder,autoTargetConfigured:!!settings?.autoTargetPeerId,trustedDeviceCount:settings?.trustedDevices?.length||0},summary:{total:checks.length,passed:checks.length-failed,failed},checks,logs};
  await log(failed?'warning':'info','diagnostic-completed',lastReport.summary);
  const host=document.getElementById('diagnosticResults');if(host){host.innerHTML='';checks.forEach(item=>{const row=document.createElement('div');row.className='diagnostic-row';const label=document.createElement('b');label.textContent=item.name;const status=document.createElement('span');status.className=item.ok?'diag-ok':'diag-fail';status.textContent=item.status;const detail=document.createElement('small');detail.textContent=item.detail;row.append(label,status,detail);host.appendChild(row);});}
  const summary=document.getElementById('diagnosticSummary');if(summary)summary.textContent=failed?failed+' de '+checks.length+' verificações falharam. Exporte o JSON e envie para análise.':'Verificações locais aprovadas. Faça também um teste real entre dois computadores.';
  return lastReport;
 };
 document.addEventListener('DOMContentLoaded',()=>{
  const run=document.getElementById('runDiagnostics'),exportButton=document.getElementById('exportDiagnostic');
  if(run)run.addEventListener('click',async()=>{run.disabled=true;run.textContent='Analisando…';try{await window.runTransferLabDiagnostics(window.transferPeer,window.transferConnection);}catch(e){await log('error','diagnostic-execution-failed',{message:e.message,stack:e.stack});alert('Falha no diagnóstico: '+e.message);}finally{run.disabled=false;run.textContent='Executar autodiagnóstico';}});
  if(exportButton)exportButton.addEventListener('click',async()=>{try{if(!lastReport)await window.runTransferLabDiagnostics(window.transferPeer,window.transferConnection);const result=await window.transferAPI.exportDiagnosticReport(lastReport);if(!result.canceled)alert('Relatório salvo em: '+result.path);}catch(e){alert('Falha ao exportar o relatório: '+e.message);}});
 });
})();