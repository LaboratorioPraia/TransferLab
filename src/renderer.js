const CHUNK = 32 * 1024;
let peer = null;
let conn = null;
let files = [];
let incoming = null;
let deviceInfo = null;
let transfers = 0;
const pendingAccept = new Map();
const pendingComplete = new Map();

const $ = id => document.getElementById(id);
const toast = message => {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3200);
};

function fmt(n) {
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return n.toFixed(1) + ' ' + units[i];
}

function row(name, size, direction) {
  const el = document.createElement('div');
  el.className = 'transferrow';
  el.innerHTML = `<div class="fileicon">${direction === 'send' ? '↑' : '↓'}</div><div class="filemeta"><b></b><small>${fmt(size)} · ${direction === 'send' ? 'Enviando' : 'Recebendo'}</small><div class="bar"><i></i></div></div><span class="percent">0%</span>`;
  el.querySelector('b').textContent = name;
  $('activityList').classList.remove('empty');
  $('activityList').innerHTML = '';
  $('activityList').appendChild(el);
  transfers++;
  $('transferCount').textContent = transfers + ' itens';
  return { bar: el.querySelector('.bar i'), pct: el.querySelector('.percent'), meta: el.querySelector('small') };
}

function setConnected(connected) {
  $('peerStatus').textContent = connected ? 'Conectado ao outro dispositivo' : 'Aguardando conexão';
  $('connectionState').textContent = connected ? 'Conectado' : (peer && peer.open ? 'Pronto para conectar' : 'Conectando ao serviço');
  $('sendBtn').disabled = !connected || files.length === 0;
}

function encodeBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function rejectPendingTransfers(message) {
  for (const resolve of pendingAccept.values()) resolve(false);
  pendingAccept.clear();
  for (const resolve of pendingComplete.values()) resolve(false);
  pendingComplete.clear();
  if (message) toast(message);
}

async function init() {
  try {
    deviceInfo = await window.transferAPI.deviceInfo();
    $('deviceName').textContent = deviceInfo.name;
    $('myId').textContent = 'Conectando...';
    peer = new Peer(undefined, {
      host: '0.peerjs.com',
      port: 443,
      path: '/',
      secure: true,
      debug: 0
    });

    window.transferPeer = peer;
    peer.on('open', id => {
      $('myId').textContent = id;
      $('connectionState').textContent = 'Pronto para conectar';
      $('peerStatus').textContent = 'Aguardando conexão';
    });

    peer.on('connection', connection => {
      if (conn && (conn.open || conn.opening)) {
        connection.close();
        return;
      }
      attach(connection);
    });

    peer.on('error', error => {
      console.error('PeerJS:', error);
      window.transferAPI.diagnosticLog({ level: 'error', event: 'peerjs-error', details: { type: error.type, message: error.message } });
      $('connectionState').textContent = 'Falha no serviço de conexão';
      toast('Falha na conexão: ' + (error.type || 'erro desconhecido'));
    });

    peer.on('disconnected', () => {
      $('connectionState').textContent = 'Reconectando ao serviço...';
      if (peer && !peer.destroyed) peer.reconnect();
    });
  } catch (error) {
    console.error(error);
    toast('Não foi possível iniciar o serviço de conexão.');
  }
}

function attach(connection) {
  conn = connection;
  window.transferConnection = connection;
  setConnected(false);
  connection.on('open', () => {
    if (conn !== connection) return;
    setConnected(true);
    toast('Conexão estabelecida. Você já pode enviar arquivos.');
  });
  connection.on('close', () => {
    if (conn === connection) {
      conn = null;
      setConnected(false);
    }
    rejectPendingTransfers('A conexão foi encerrada.');
  });
  connection.on('error', error => {
    console.error('DataConnection:', error);
    window.transferAPI.diagnosticLog({ level: 'error', event: 'data-connection-error', details: { message: error.message } });
    toast('Erro no canal de transferência.');
  });
  connection.on('data', data => {
    if (conn === connection) handleData(data);
  });
}

$('connectBtn').onclick = () => {
  const id = $('remoteId').value.trim();
  if (!id) return toast('Informe o código do dispositivo.');
  if (!peer || !peer.open) return toast('O serviço de conexão ainda está iniciando.');
  if (id === peer.id) return toast('Este é o código deste computador.');
  if (conn && (conn.open || conn.opening)) return toast('Já existe uma conexão em andamento.');
  try {
    $('connectionState').textContent = 'Chamando dispositivo...';
    attach(peer.connect(id, { reliable: true }));
  } catch (error) {
    console.error(error);
    toast('Não foi possível iniciar a conexão.');
  }
};

$('chooseFiles').onclick = async () => {
  files = await window.transferAPI.pickFiles();
  renderFiles();
};

function renderFiles() {
  $('selectedFiles').textContent = files.length
    ? files.map(file => `${file.name} (${fmt(file.size)})`).join(' · ')
    : '';
  $('sendBtn').disabled = !(conn && conn.open && files.length);
}

$('sendBtn').onclick = async () => {
  if (!conn || !conn.open) return toast('Conecte-se ao outro dispositivo primeiro.');
  $('sendBtn').disabled = true;
  try {
    for (const file of files) {
      if (!conn || !conn.open) throw new Error('A conexão foi perdida.');
      await sendFile(file);
    }
    files = [];
    renderFiles();
  } catch (error) {
    console.error(error);
    window.transferAPI.diagnosticLog({ level: 'error', event: 'transfer-failed', details: { message: error.message, stack: error.stack } });
    toast('A transferência foi interrompida: ' + error.message);
  } finally {
    renderFiles();
  }
};

function waitFor(map, id, timeoutMs, label) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      map.delete(id);
      resolve(false);
    }, timeoutMs);
    map.set(id, value => {
      clearTimeout(timer);
      map.delete(id);
      resolve(value);
    });
  });
}

async function sendFile(file) {
  const id = crypto.randomUUID();
  const ui = row(file.name, file.size, 'send');
  const accepted = waitFor(pendingAccept, id, 120000, 'aceitação');
  conn.send({ type: 'file-start', id, name: file.name, size: file.size });
  if (!(await accepted)) {
    ui.pct.textContent = 'Não aceito';
    ui.meta.textContent = fmt(file.size) + ' · Não recebido';
    throw new Error('O outro dispositivo não aceitou o arquivo ou não respondeu.');
  }

  let offset = 0;
  while (offset < file.size) {
    if (!conn || !conn.open) throw new Error('A conexão foi perdida durante o envio.');
    const length = Math.min(CHUNK, file.size - offset);
    const chunk = await window.transferAPI.readChunk(file.path, offset, length);
    if (!chunk || !chunk.byteLength) throw new Error('Não foi possível ler o arquivo de origem.');
    try { conn.send({ type: 'file-chunk', id, offset, data: encodeBase64(chunk) }); }
    catch (error) { throw new Error('Falha ao transmitir bloco ' + offset + ': ' + error.message); }
    offset += chunk.byteLength;

    const percent = Math.floor(offset / file.size * 100);
    ui.bar.style.width = percent + '%';
    ui.pct.textContent = percent + '%';

    while (conn && conn.open && conn.dataChannel && conn.dataChannel.bufferedAmount > 1024 * 1024) {
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }

  const completed = waitFor(pendingComplete, id, 120000, 'confirmação');
  try { conn.send({ type: 'file-end', id }); }
  catch (error) { throw new Error('Falha ao finalizar o envio: ' + error.message); }
  if (!(await completed)) throw new Error('O destinatário não confirmou a gravação do arquivo.');
  ui.bar.style.width = '100%';
  ui.pct.textContent = 'Enviado';
  ui.meta.textContent = fmt(file.size) + ' · Recebimento confirmado';
}

async function handleData(data) {
  if (!data || typeof data !== 'object') return;

  if (data.type === 'file-start') {
    if (incoming) {
      conn.send({ type: 'file-reject', id: data.id, reason: 'busy' });
      return;
    }
    if (typeof data.id !== 'string' || typeof data.name !== 'string' ||
        !Number.isSafeInteger(data.size) || data.size < 0) {
      conn.send({ type: 'file-reject', id: data.id, reason: 'invalid' });
      return;
    }

    const target = await window.transferAPI.saveStart(data.name);
    if (!target) {
      conn.send({ type: 'file-reject', id: data.id, reason: 'cancelled' });
      toast('Recebimento cancelado.');
      return;
    }

    incoming = {
      id: data.id,
      name: data.name,
      size: data.size,
      path: target.path,
      received: 0,
      ui: row(data.name, data.size, 'receive')
    };
    conn.send({ type: 'file-accept', id: data.id });
    return;
  }

  if (data.type === 'file-accept') {
    const resolve = pendingAccept.get(data.id);
    if (resolve) resolve(true);
    return;
  }

  if (data.type === 'file-reject') {
    const resolve = pendingAccept.get(data.id);
    if (resolve) resolve(false);
    toast('O outro dispositivo recusou o arquivo.');
    return;
  }

  if (data.type === 'file-chunk') {
    if (!incoming || data.id !== incoming.id || typeof data.data !== 'string') return;
    const buffer = decodeBase64(data.data);
    if (data.offset !== incoming.received || incoming.received + buffer.byteLength > incoming.size) {
      toast('Bloco inválido recebido. Transferência cancelada.');
      incoming = null;
      return;
    }
    await window.transferAPI.saveChunk(incoming.path, buffer, data.offset);
    incoming.received += buffer.byteLength;
    const percent = incoming.size ? Math.min(100, Math.floor(incoming.received / incoming.size * 100)) : 100;
    incoming.ui.bar.style.width = percent + '%';
    incoming.ui.pct.textContent = percent + '%';
    return;
  }

  if (data.type === 'file-end') {
    if (!incoming || data.id !== incoming.id) return;
    const current = incoming;
    const result = await window.transferAPI.saveFinish(current.path);
    if (result.ok && result.size === current.size && current.received === current.size) {
      current.ui.bar.style.width = '100%';
      current.ui.pct.textContent = 'Recebido';
      current.ui.meta.textContent = fmt(result.size) + ' · Recebido';
      conn.send({ type: 'file-complete', id: current.id, size: result.size });
      toast('Arquivo recebido: ' + current.name);
      window.transferAPI.openPath(current.path);
    } else {
      conn.send({ type: 'file-reject', id: current.id, reason: 'size-mismatch' });
      current.ui.pct.textContent = 'Falha';
      toast('O tamanho do arquivo recebido não confere.');
    }
    incoming = null;
    return;
  }

  if (data.type === 'file-complete') {
    const resolve = pendingComplete.get(data.id);
    if (resolve) resolve(true);
  }
}

const dropzone = $('dropzone');
dropzone.addEventListener('dragover', event => {
  event.preventDefault();
  dropzone.style.background = '#f4f7fd';
});
dropzone.addEventListener('dragleave', () => { dropzone.style.background = ''; });
dropzone.addEventListener('drop', event => {
  event.preventDefault();
  dropzone.style.background = '';
  toast('Use Selecionar arquivos para escolher os arquivos.');
});

$('copyId').onclick = async () => {
  try {
    await navigator.clipboard.writeText(peer.id);
    toast('Código copiado.');
  } catch {
    toast('Não foi possível copiar o código.');
  }
};

document.querySelectorAll('.nav').forEach(button => {
  button.onclick = () => {
    document.querySelectorAll('.nav').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('visible'));
    $('tab-' + button.dataset.tab).classList.add('visible');
    $('pageTitle').textContent = ({
      transfer: 'Enviar arquivos',
      devices: 'Dispositivos',
      history: 'Histórico',
      settings: 'Configurações'
    })[button.dataset.tab];
  };
});

init();
