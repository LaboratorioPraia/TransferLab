# TransferLab 0.1.2 — versão de testes

Aplicativo Windows para transferência de arquivos entre PCs pela internet usando PeerJS/WebRTC DataChannel.

## Correções e recursos desta versão
- Identidade permanente do dispositivo para que o código não mude a cada abertura.
- Confirmação de recebimento por bloco: o remetente só avança depois que o receptor confirma a gravação daquele bloco.
- Processamento sequencial dos dados recebidos para impedir concorrência entre gravações.
- Arquivo recebido primeiro em extensão temporária .part e movido para o nome final somente após validar o tamanho.
- Evita sobrescrita automática: cria sufixos (1), (2) etc.
- Pareamento de dispositivo confiável com chave compartilhada aleatória; o receptor só faz recebimento sem diálogo após autenticar o dispositivo.
- Pasta padrão de recebimento para dispositivos autenticados.
- Monitoramento de uma pasta para envio automático ao dispositivo permanente configurado.
- Antes de enviar automaticamente, aguarda quatro intervalos consecutivos de tamanho estável e verifica se o arquivo pode ser aberto para leitura.
- Opção para iniciar com o Windows.
- Autodiagnóstico com exportação de relatório JSON e logs técnicos.

## Como configurar recebimento automático
1. Instale e abra o TransferLab nos dois PCs.
2. No PC que receberá os arquivos, abra a tela Dispositivos.
3. No PC remetente, conecte usando o código permanente do PC receptor.
4. No receptor, clique em “Confiar neste dispositivo”. Uma chave aleatória é compartilhada pela conexão criptografada.
5. Na tela Configurações do receptor, selecione a pasta padrão de recebimento.
6. Os próximos arquivos daquele dispositivo confiável serão salvos nessa pasta sem abrir diálogo.

## Como configurar envio automático
1. No PC remetente, abra Configurações.
2. Escolha a pasta monitorada.
3. Informe o código permanente do PC receptor.
4. Salve as configurações.
5. No receptor, o PC remetente precisa estar cadastrado como confiável.

O monitor aguarda o tamanho permanecer igual por quatro intervalos consecutivos de um segundo. Também tenta abrir o arquivo para leitura. Se não estabilizar em até 90 segundos, o arquivo não será enviado. Para arquivos que programas deixam temporariamente parados antes de continuar escrevendo, aumente esse intervalo em versão futura ou mantenha o envio manual.

## Diagnóstico
Em Configurações, clique “Executar autodiagnóstico” e depois “Exportar relatório JSON”. O relatório inclui estado de rede, sessão PeerJS, canal WebRTC, testes de escrita/leitura e logs recentes. Envie o JSON quando houver falha.

## Limitações importantes
- A conectividade depende do WebRTC e do servidor público de sinalização PeerJS. Redes com NAT/firewall restritivo podem impedir conexão; ainda não há servidor TURN próprio.
- A conexão e o transporte WebRTC são criptografados, mas esta versão ainda não tem serviço de retransmissão TURN nem infraestrutura própria de identidade.
- O monitoramento atual observa arquivos diretamente dentro da pasta selecionada; subpastas não são monitoradas recursivamente.
- O monitoramento requer que o TransferLab permaneça aberto. O recebimento automático exige que o receptor esteja aberto e acessível.
- Ainda não há retomada automática de transferências interrompidas.
- Use esta versão para testes controlados antes de confiar arquivos críticos.

## Desenvolvimento
Requer Node.js 22.

```bash
npm install
npm start
npm run dist
```

O workflow GitHub Actions valida a sintaxe dos arquivos JavaScript e compila o instalador Windows.
