# TransferLab 0.1.3 — versão de validação

Aplicativo Windows para transferência de arquivos entre PCs por PeerJS/WebRTC DataChannel.

## Alterações desta versão
- UUID permanente mostrado localmente antes da conexão com o servidor de sinalização.
- Estados separados para identificação local, sinalização e canal de dados.
- Handshake bilateral de identificação; o aplicativo não presume que a conexão está pronta apenas porque o PeerJS abriu.
- Blocos menores (16 KiB), com confirmação do receptor somente depois da gravação no disco.
- O remetente só mostra 100% após confirmação de gravação final pelo destino.
- Erros de conexão, sinalização, autenticação e transferência registrados no log técnico.
- Autorização de dispositivo confiável e recebimento automático na pasta padrão.
- Monitoramento aguarda 30 verificações consecutivas de tamanho estável (30 segundos), testa leitura e confirma que o arquivo não mudou durante a verificação.
- Ignora arquivos temporários comuns (.part, .tmp, .temp, .crdownload, .download).
- Diagnóstico exportável com UUID, estado PeerJS, DataChannel, ICE quando exposto pela biblioteca, configuração local e logs recentes.

## Configuração de recebimento automático
1. Instale e abra o TransferLab nos dois computadores.
2. No computador que receberá, escolha a pasta padrão em Configurações.
3. Conecte o computador remetente ao UUID permanente exibido no receptor.
4. No computador receptor, abra Dispositivos e clique em “Confiar neste dispositivo” para autorizar o remetente.
5. No computador remetente, escolha a pasta monitorada, informe o UUID permanente do receptor e salve.

A autorização deve ser feita no computador que receberá, pois é ele que decide quais remetentes podem gravar automaticamente.

## Monitoramento de pasta
O monitoramento aguarda 30 segundos consecutivos sem alteração do tamanho, tenta abrir o arquivo para leitura e confere novamente tamanho e data de modificação. Arquivos que não estabilizarem em até 5 minutos não serão enviados. Arquivos temporários comuns são ignorados. Isso reduz o risco de enviar arquivos ainda em gravação, mas nenhum teste genérico consegue garantir que um programa não fará uma nova gravação depois de uma pausa longa; para fluxos críticos, configure o programa gerador para gravar primeiro com extensão temporária e renomear para a extensão final somente quando concluir.

## Diagnóstico
Em Configurações, clique em “Executar autodiagnóstico” e depois em “Exportar relatório JSON”. O relatório inclui verificações locais, sessão PeerJS, DataChannel, estado ICE quando disponível e logs recentes. O UUID permanente é preservado mesmo se o servidor de sinalização estiver fora do ar.

## Limitações de rede
O servidor público PeerJS é usado para sinalização; os arquivos trafegam diretamente pelo WebRTC. STUN auxilia a descoberta de rotas, mas não substitui TURN. Redes com NAT simétrico, firewall corporativo ou bloqueio UDP podem impedir a conexão direta. Esta versão não inclui servidor TURN próprio nem retransmissão de arquivos. Nesses cenários, o diagnóstico deverá indicar falha de canal/ICE; não será correto afirmar que a transferência funciona em toda e qualquer rede.

## Desenvolvimento
Requer Node.js 22.

```bash
npm install
npm start
npm run dist
```
