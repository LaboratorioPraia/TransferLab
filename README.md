# TransferLab 0.2.0 — atualização de interface e execução contínua

Aplicativo Windows para transferência de arquivos entre computadores usando PeerJS/WebRTC DataChannel.

## Principais melhorias
- Nova interface clean/neumórfica, com fundo claro, cartões arredondados, sombras suaves e destaque azul.
- Janela principal sem moldura e sem barra de menu superior.
- Fechar/ocultar a janela mantém o aplicativo na bandeja do Windows; o menu da bandeja permite reabrir ou sair completamente.
- Inicialização automática habilitada por padrão em instalações novas. A opção continua configurável em Configurações.
- Instância única para evitar conflitos com o identificador permanente do dispositivo.
- Monitoramento de pasta ativo enquanto o aplicativo está em execução, com eventos do sistema de arquivos e varredura periódica para recuperar eventos perdidos.
- Arquivos existentes são registrados como linha de base ao iniciar o monitoramento; não são reenviados só porque o aplicativo reiniciou. Arquivos novos ou modificados entram no fluxo de estabilidade.
- Arquivos monitorados precisam manter tamanho e data de modificação estáveis por aproximadamente 30 segundos antes de serem liberados.
- Verificação SHA-256 do arquivo de origem e do arquivo recebido antes da confirmação final. O destino não publica o arquivo final se o tamanho ou hash não corresponder.
- Diálogo independente, centralizado e visualmente consistente para envio e recebimento, com progresso em tempo real.
- O preload agora encaminha os metadados esperados ao processo principal em cada leitura de bloco, mantendo a validação de tamanho e modificação.

## Instalador universal
O workflow compila dois pacotes:
- Windows x64: Electron 35.
- Windows x86 (32 bits): Electron 22.3.27, última linha do Electron com suporte à arquitetura ia32.

Um pequeno instalador NSIS detecta a arquitetura do Windows e abre o instalador correspondente. O usuário recebe um único arquivo `TransferLab-Setup-0.2.0.exe`.

**Observação importante sobre 32 bits:** o pacote x86 precisa usar Electron 22, uma versão antiga e sem suporte de segurança upstream. Ele é necessário para compatibilidade com sistemas Windows 32 bits, mas não oferece o mesmo nível de atualizações de segurança do pacote x64 baseado em Electron 35. Para uso conectado à internet, recomendamos Windows 64 bits sempre que o hardware permitir. O build x86 precisa passar pela compilação e por testes em um Windows 32 bits real antes de ser considerado homologado.

## Segundo plano e monitoramento
- Fechar a janela principal apenas a oculta; o aplicativo continua ativo na bandeja.
- Para encerrar completamente, use o menu da bandeja e escolha “Sair completamente”.
- A inicialização automática é registrada nas configurações de login do Windows.
- O monitoramento permanece ativo enquanto o processo do TransferLab estiver rodando. Ele não pode monitorar com o computador desligado, em suspensão profunda ou após o usuário encerrar o processo.

## Proteção contra arquivos ainda em construção
O monitoramento aguarda 30 segundos consecutivos sem alteração de tamanho ou data de modificação, verifica se o arquivo pode ser lido e depois calcula SHA-256. O remetente transmite o hash; o receptor calcula novamente antes de renomear o arquivo temporário para o nome final. Se os valores divergirem, o arquivo parcial é descartado e o remetente não recebe confirmação.

Nenhum tempo fixo de estabilidade garante que um programa não volte a escrever depois de uma pausa longa. Para fluxos críticos, configure o programa gerador para salvar com extensão temporária e renomear para a extensão final somente após concluir. A validação SHA-256 protege a integridade dos bytes recebidos, mas não determina se o programa de origem já concluiu logicamente o documento.

## Testes necessários antes de uso geral
1. Instalar em Windows 64 bits e confirmar a inicialização automática.
2. Fechar a janela e verificar que o ícone permanece na bandeja.
3. Reiniciar o Windows e confirmar que o TransferLab inicia oculto.
4. Testar envio manual de arquivo pequeno e arquivo grande entre dois computadores.
5. Testar pasta monitorada com arquivo sendo gravado lentamente, incluindo pausa de gravação superior a 30 segundos.
6. Confirmar que o receptor só publica arquivos com SHA-256 correspondente.
7. Testar o instalador universal em uma máquina Windows 32 bits física ou virtual.

A compilação bem-sucedida não substitui os testes de transferência entre dois computadores e o teste de instalação em Windows 32 bits.

## Rede
A sinalização usa o servidor público PeerJS (0.peerjs.com) e os arquivos trafegam diretamente pelo WebRTC. STUN auxilia a descoberta de rotas, mas não substitui TURN. Redes com NAT simétrico, firewall corporativo ou bloqueio UDP podem impedir uma conexão direta. Esta versão ainda não inclui servidor TURN próprio nem retransmissão de arquivos; portanto, não é correto prometer conexão em toda rede.

## Desenvolvimento
Requer Node.js 22 no ambiente de desenvolvimento.

```bash
npm install
npm start
npm run dist
```
