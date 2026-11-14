(() => {
  const log = async (level,event,details) => { try { await window.transferAPI.diagnosticLog({level,event,details}); } catch {} };
  window.addEventListener('error',e=>log('error','window-error',{message:e.message,source:e.filename,line:e.lineno,column:e.colno}));
  window.addEventListener('unhandledrejection',e=>log('error','unhandled-rejection',{reason:String(e.reason?.stack||e.reason||'unknown')}));
  const check=(name,ok,detail)=>({name,status:ok?'OK':'FALHA',ok:!!ok,detail:String(detail||'')});
  window.runTransferLabDiagnostics=async(peer,conn)=>{
    const results=[];
    results.push(check('Interface carregada',!!document.getElementById('sendBtn'),'Componentes principais encontrados.'));
    results.push(check('API segura do aplicativo',!!window.transferAPI?.deviceInfo,'Preload / IPC disponível.'));
    results.push(check('Biblioteca PeerJS',typeof window.Peer==='function',typeof window.Peer));
    results.push(check('Internet disponível',navigator.onLine,navigator.onLine?'Navegador informa conexão ativa.':'Sem conexão de rede detectada.'));
    results.push(check('WebRTC no navegador',!!(window.RTCPeerConnection||window.webkitRTCPeerConnection),'Suporte necessário para conexão direta.'));
    let device=null,local=null,logs=[];
    try{device=await window.transferAPI.deviceInfo();results.push(check('Identificação do dispositivo',!!device?.name&&!!device?.id,device?.name+' · '+device?.version));}
    catch(e){results.push(check('Identificação do dispositivo',false,e.message));}
    try{
      local=await window.transferAPI.diagnosticSelfTest();
      results.push(check('Gravação/leitura temporária',local.tempWriteReadDelete,local.tempError||'Teste de escrita, leitura e exclusão.'));
      results.push(check('Pasta de dados',local.userDataWritable,local.userDataError||'Acesso de escrita validado.'));
      results.push(check('Gravação de logs',local.logWritable,local.logError||'Log local gravável.'));
    }catch(e){results.push(check('Testes locais do Windows',false,e.message));}
    results.push(check('Sessão PeerJS',!!peer?.open&&!peer?.destroyed,peer?.id||'Sem sessão ativa; verifique internet/firewall.'));
    results.push(check('Conexão com outro dispositivo',!!conn?.open,conn?.open?'Canal aberto.':'Nenhum dispositivo conectado.'));
    results.push(check('Canal WebRTC',!!conn?.dataChannel&&conn.dataChannel.readyState==='open',conn?.dataChannel?.readyState||'Canal indisponível.'));
    try{logs=await window.transferAPI.diagnosticReadLogs();}catch(e){logs=[{level:'error',event:'read-logs-failed',details:e.message}];}
    const failed=results.filter(x=>!x.ok).length;
    const report={product:'TransferLab',version:device?.version||'0.1.2',reportVersion:2,generatedAt:new Date().toISOString(),app:device||{},localTests:local||{},userAgent:navigator.userAgent,network:{online:navigator.onLine,peerId:peer?.id||null,peerOpen:!!peer?.open,connectionOpen:!!conn?.open,dataChannelState:conn?.dataChannel?.readyState||'indisponível'},summary:{total:results.length,passed:results.length-failed,failed},checks:results,logs};
    await log(failed?'warning':'info','diagnostic-completed',report.summary);
    const host=document.getElementById('diagnosticResults');
    if(host){host.innerHTML='';results.forEach(item=>{const row=document.createElement('div');row.className='diagnostic-row';const label=document.createElement('b');label.textContent=item.name;const status=document.createElement('span');status.className=item.ok?'diag-ok':'diag-fail';status.textContent=item.status;const detail=document.createElement('small');detail.textContent=item.detail;row.append(label,status,detail);host.appendChild(row);});}
    const summary=document.getElementById('diagnosticSummary');
    if(summary)summary.textContent=failed?failed+' de '+results.length+' verificações falharam. Exporte e envie o relatório.':'Testes locais aprovados. A transferência real ainda deve ser validada entre dois PCs.';
    const exportButton=document.getElementById('exportDiagnostic');
    if(exportButton)exportButton.onclick=async()=>{try{const result=await window.transferAPI.exportDiagnosticReport(report);if(!result.canceled)alert('Relatório salvo: '+result.path);}catch(e){alert('Falha ao exportar: '+e.message);}};
    return report;
  };
  document.addEventListener('DOMContentLoaded',()=>{
    const button=document.getElementById('runDiagnostics');
    if(button)button.addEventListener('click',async()=>{button.disabled=true;button.textContent='Analisando...';try{await window.runTransferLabDiagnostics(window.transferPeer,window.transferConnection);}finally{button.disabled=false;button.textContent='Executar autodiagnóstico';}});
  });
})();
