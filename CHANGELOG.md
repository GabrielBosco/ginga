# Histórico de versões

As mudanças relevantes do Ginga são registradas neste arquivo.

O projeto segue versionamento semântico enquanto avança para a versão `1.0.0`.

## [0.3.1] - 2026-08-27

### Corrigido

- identidade interna `SISTEMA` nao exibe acoes humanas de amizade, DM, timeout, expulsao ou banimento, com bloqueio equivalente tambem no backend;
- criacao de webhook ganhou fluxo guiado, validacao antes do envio e mensagens de erro mais claras no painel de Integracoes e no Portal do Desenvolvedor.

## [0.3.0] - 2026-08-27

### Adicionado

- gerenciamento de dispositivos confiaveis do 2FA, com identificacao do dispositivo atual e revogacao individual ou em massa;
- pesquisa global de mensagens por servidor com filtros de canal, autor, periodo, anexos e links;
- atalho `Ctrl+Shift+F` para pesquisa global e salto direto para a mensagem encontrada;
- painel administrativo de saude com PostgreSQL, LiveKit, WebSocket, armazenamento, memoria e uptime da API;
- visualizador de multiplas transmissoes simultaneas com troca entre streams sem fechar o player;
- classificacao de qualidade da chamada baseada em latencia, jitter e perda de pacotes.

### Corrigido

- estado `AO VIVO` agora e preservado quando eventos de mute/deafen nao informam o estado de streaming;
- fluxo de 2FA nao solicita novamente a senha depois que a credencial primaria ja foi validada;
- opcao de lembrar o dispositivo por 30 dias no desafio 2FA;
- sons de voz separados por acao para entrada, saida, mute, deafen, camera e transmissao;
- corrida de estado em chamadas e salto de mensagens entre canais com fallback de navegacao;

### Seguranca e operacao

- token de dispositivo confiavel armazenado no banco somente como hash e vinculado ao User-Agent;
- dispositivos confiaveis sao revogados ao trocar senha, desativar 2FA ou encerrar todas as sessoes;
- painel de saude restrito a administradores da plataforma;
- pesquisa global continua respeitando as permissoes efetivas de visualizacao de cada canal;
- pacote de upgrade 0.3.0 inclui backup, auditoria, build opcional e rollback automatico em caso de falha de validacao;
- Nginx nao entrega pagina padrao nem header `Server`, possui paginas de erro Ginga e bloqueio de arquivos sensiveis;
- limite `nofile` do Web/Nginx alinhado em 65535 para evitar gargalo com WebSocket e transmissoes.

## [0.2.0] - 2026-08-27

### Adicionado

- presença de jogos no cliente Desktop;
- sobreposição Desktop com jogo, canal de voz e participantes;
- Push-to-Talk configurável por tecla ou botão do mouse;
- autenticação em duas etapas TOTP com códigos de recuperação;
- fluxo seguro de redefinição de senha por e-mail;
- validação de senhas expostas usando Pwned Passwords por k-anonymity;
- melhorias no Portal de Administração, Portal do Desenvolvedor e Base de Conhecimento;
- pipeline assinado de atualização do Windows;
- auditoria de produção e verificação antes de publicação como código aberto;
- base Android experimental;
- melhorias de responsividade para celulares.

### Corrigido

- troca de presença Online/Ausente/Ocupado/Invisível;
- inconsistências de payload e tratamento de erros internos;
- layout da Base de Conhecimento e modais;
- detecção de processos de jogos no Desktop;
- nova tentativa automática ao consultar o manifesto de atualização;
- proteção contra reutilização simultânea de código de recuperação;
- resolução de e-mail com MX e alternativa A/AAAA;
- referências legadas de servidor no Desktop.

### Segurança

- segredos locais mantidos fora do repositório;
- PostgreSQL e Redis sem publicação direta na configuração de produção;
- containers com `no-new-privileges` e API em modo somente leitura onde aplicável;
- limites de requisição, validação de upload e sessões revogáveis;
- endpoint de informações internas restrito à administração global.
