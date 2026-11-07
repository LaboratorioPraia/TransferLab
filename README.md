# TransferLab 0.1.0 — protótipo Windows

Aplicativo Electron para teste de transferência de arquivos entre dois PCs usando PeerJS/WebRTC DataChannel e o serviço público de sinalização PeerJS.

## O que funciona nesta primeira versão
- Identificador de sessão gerado pelo serviço PeerJS.
- Conexão entre dois computadores pela internet quando a rede permite conexão P2P via ICE/STUN.
- Envio manual de arquivos em blocos.
- Escolha do local de salvamento no computador receptor.
- Barra de progresso e verificação do tamanho final.
- Não sobrescreve silenciosamente: o diálogo de gravação permite escolher outro nome.

## Limitações conhecidas do protótipo
- Usa sinalização pública PeerJS e conectividade WebRTC direta; ainda não inclui TURN próprio. Redes com NAT/firewall restritivo podem impedir conexão.
- O código PeerJS é um identificador de sessão, não é ainda um sistema completo de identidade/autorização. Compartilhe apenas com pessoa de confiança.
- Ainda não inclui pareamento persistente, senha rotativa, criptografia de aplicação adicional, monitoramento de pastas, inicialização com Windows, fila offline, retomada após queda, histórico persistente ou apps móveis.
- Arquivos são transmitidos em blocos, mas a retomada de transferência ainda não está implementada.
- Esta versão é para testes controlados, não para uso com dados sensíveis ou produção.

## Desenvolvimento
Requer Node.js 22.

```bash
npm install
npm start
```

## Gerar instalador Windows
Em Windows:

```bash
npm install
npm run dist
```

O instalador será criado em `release/`.

Também há um workflow em `.github/workflows/build-windows.yml`. Envie este projeto para um repositório GitHub e execute Actions > Build Windows installer. O instalador ficará disponível em Artifacts.

## Teste em dois PCs
1. Instale e abra TransferLab nos dois computadores.
2. No PC receptor, copie o código mostrado na área “Receber arquivos”.
3. No PC remetente, cole o código no campo “Código do dispositivo de destino” e clique Conectar.
4. Quando aparecer Conectado, selecione os arquivos e clique Enviar arquivos.
5. No receptor, escolha onde salvar. Ao concluir, o arquivo será aberto na pasta selecionada.

Ambos os computadores precisam ter acesso à internet. A primeira conexão pode falhar em redes corporativas ou roteadores que bloqueiam WebRTC.
