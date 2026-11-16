# TransferLab 0.1.5 — versão de correção e validação

Aplicativo Windows para transferência de arquivos entre computadores usando PeerJS/WebRTC DataChannel.

## Correções incluídas nesta versão
- Corrigido o filtro de extensões temporárias da pasta monitorada: .part, .tmp, .temp, .crdownload, .download e .partial.
- Arquivos ocultos e nomes iniciados por "~" são ignorados pelo monitoramento.
- A pasta monitorada exige 15 intervalos consecutivos de tamanho e data de modificação estáveis (aproximadamente 15 segundos) antes de liberar um arquivo.
- O remetente valida tamanho e data de modificação do arquivo em cada leitura de bloco. Se o arquivo mudar depois de selecionado ou durante o envio, a leitura falha em vez de enviar conteúdo possivelmente incompleto.
- Os metadados de modificação são transportados da seleção e do monitoramento para a rotina de envio.
- O handshake e as mensagens de transferência passam a anunciar protocolo 4 de forma consistente.
- A interface atualiza o estado do botão de envio após identificar o dispositivo remoto.
- O listener da pasta monitorada é registrado antes de iniciar o watcher para reduzir a possibilidade de perder o primeiro evento.
- Versão do instalador e do relatório de diagnóstico atualizadas para 0.1.5.

## Configuração de recebimento automático
1. Instale a mesma versão do TransferLab nos dois computadores.
2. No computador receptor, configure a pasta padrão em Configurações.
3. Conecte o computador remetente ao código permanente exibido no receptor.
4. No receptor, autorize o remetente em Dispositivos.
5. No remetente, selecione a pasta monitorada, informe o código permanente do receptor e salve.

A autorização é concedida no computador que recebe. O receptor continua responsável por escolher quais dispositivos podem gravar automaticamente.

## Proteção de arquivos ainda em gravação
O monitoramento aguarda estabilidade do tamanho e do horário de modificação por aproximadamente 15 segundos e verifica novamente os metadados antes de liberar o arquivo. Durante o envio, cada bloco é lido com validação dos mesmos metadados. Se o programa que gerou o arquivo continuar gravando, o envio será interrompido em vez de continuar com uma cópia inconsistente.

Nenhum intervalo de estabilidade genérico pode garantir que um programa não volte a gravar um arquivo após uma pausa longa. Para fluxos críticos, configure o programa gerador para gravar primeiro com extensão temporária e renomear para a extensão final somente quando concluir.

## Diagnóstico
Em Configurações, clique em “Executar autodiagnóstico” e depois em “Exportar relatório JSON”. O relatório inclui verificações locais, estado PeerJS, DataChannel, estado ICE quando exposto pela biblioteca e logs recentes.

## Limitações de rede conhecidas
A sinalização usa o servidor público PeerJS (0.peerjs.com) e os arquivos trafegam diretamente pelo WebRTC. STUN auxilia a descoberta de rotas, mas não substitui TURN. Redes com NAT simétrico, firewall corporativo ou bloqueio UDP podem impedir uma conexão direta. Esta versão ainda não inclui servidor TURN próprio nem retransmissão de arquivos. Portanto, não se deve prometer funcionamento em toda rede sem um teste real no ambiente de destino.

## Desenvolvimento
Requer Node.js 22.

```bash
npm install
npm start
npm run dist
```
