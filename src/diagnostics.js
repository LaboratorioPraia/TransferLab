(() => {
  const log = async (level, event, details) => {
    try { await window.transferAPI.diagnosticLog({ level, event, details }); } catch {}
  };
  window.addEventListener('error', event => { log('error', 'window-error', { message: event.message, source: event.filename, line: event.lineno, column: event.colno }); });
  window.addEventListener('unhandledrejection', event => { log('error', 'unhandled-rejection', { reason: String(event.reason?.stack || event.reason || 'unknown') }); });

  const check = (name, ok, detail) => ({ name, status: ok ? 'OK' : 'FALHA', ok: !!ok, detail: String(detail || '') });
  window.runTransferLabDiagnostics = async (peer, conn) => {
    const results = [];
    results.push(check('Interface carregada', !!document.getElementById('sendBtn'), 'Componentes principais encontrados.'));
    results.push(check('API segura do aplicativo', !!window.transferAPI?.deviceInfo, 'Preload / IPC disponível.'));
    results.push(check('Biblioteca PeerJS', typeof window.Peer === 'function', typeof window.Peer));\n    results.push(check('Internet disponível', navigator.onLine, navigator.onLine ? 'Navegador informa conexão ativa.' : 'Sem conexão de rede detectada.'));\n    results.push(check('WebRTC no navegador', !!(window.RTCPeerConnection || window.webkitRTCPeerConnection), 'Suporte necessário para conexão direta entre dispositivos.'));
    let device = null;
    try { device = await window.transferAPI.deviceInfo(); results.push(check('Identificação do dispositivo', !!device?.name && !!device?.id, device ? device.name + ' · ' + device.version : 'Sem resposta')); }
    catch (e) { results.push(check('Identificação do dispositivo', false, e.message)); }
    try {
      const local = await window.transferAPI.diagnosticSelfTest();
      results.push(check('Gravação e leitura temporária', local.tempWriteReadDelete, local.tempError || 'Teste de escrita/leitura/exclusão.'));
      results.push(check('Pasta de dados do aplicativo', local.userDataWritable, local.userDataError || 'Acesso de escrita validado.'));
      results.push(check('Gravação de logs', local.logWritable, local.logError || 'Log local gravável.'));
    } catch (e) { results.push(check('Testes locais do Windows', false, e.message)); }
    results.push(check('Conexão com servidor PeerJS', !!peer?.open && !peer?.destroyed, peer?.id ? 'Sessão ativa: ' + peer.id : 'Sem sessão ativa; verifique internet/firewall.'));
    results.push(check('Conexão com outro dispositivo', !!conn?.open, conn?.open ? 'Canal de dados aberto.' : 'Nenhum dispositivo conectado.'));
    results.push(check('Canal de transferência', !!conn?.dataChannel && conn.dataChannel.readyState === 'open', conn?.dataChannel?.readyState || 'Canal indisponível.'));
    let recentLogs = [];\n    try { recentLogs = await window.transferAPI.diagnosticReadLogs(); } catch (e) { recentLogs = [{ level: 'error', event: 'read-logs-failed', details: e.message }]; }\n    const failed = results.filter(item => !item.ok).length;
    const report = {
      product: 'TransferLab', reportVersion: 1, generatedAt: new Date().toISOString(),
      app: device || {}, userAgent: navigator.userAgent,
      network: { online: navigator.onLine, peerId: peer?.id || null, peerOpen: !!peer?.open, connectionOpen: !!conn?.open, dataChannelState: conn?.dataChannel?.readyState || 'indisponível' },
      summary: { total: results.length, passed: results.length - failed, failed },
      checks: results
    };
    await log(failed ? 'warning' : 'info', 'diagnostic-completed', report.summary);
    const host = document.getElementById('diagnosticResults');
    if (host) {
      host.innerHTML = '';
      results.forEach(item => {
        const row = document.createElement('div');
        row.className = 'diagnostic-row';
        const label = document.createElement('b'); label.textContent = item.name;
        const status = document.createElement('span'); status.className = item.ok ? 'diag-ok' : 'diag-fail'; status.textContent = item.status;
        const detail = document.createElement('small'); detail.textContent = item.detail;
        row.append(label, status, detail); host.appendChild(row);
      });
      const summary = document.getElementById('diagnosticSummary');
      if (summary) summary.textContent = failed ? failed + ' de ' + results.length + ' verificações falharam. Exporte o relatório e envie para análise.' : 'Todos os testes locais passaram. A transferência real ainda deve ser testada entre dois dispositivos.';
    }
    const exportButton = document.getElementById('exportDiagnostic');
    if (exportButton) exportButton.onclick = async () => {
      try {
        const result = await window.transferAPI.exportDiagnosticReport(report);
        if (!result.canceled) { await log('info', 'diagnostic-report-exported'); alert('Relatório salvo com sucesso.'); }
      } catch (e) { alert('Não foi possível salvar o relatório: ' + e.message); }
    };
    return report;
  };
  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('runDiagnostics');
    if (button) button.addEventListener('click', async () => {
      button.disabled = true; button.textContent = 'Analisando...';
      try { await window.runTransferLabDiagnostics(window.transferPeer, window.transferConnection); }
      finally { button.disabled = false; button.textContent = 'Executar autodiagnóstico'; }
    });
  });
})();
