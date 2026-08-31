# Ginga 0.4.5 — GIF de perfil/banner

- avatar do usuario aceita PNG/JPG/WebP/GIF; GIF animado e preservado sem conversao por canvas
- banner do perfil aceita GIF animado e mantem a animacao nos cards/perfil completo
- icone e banner do servidor passam a aceitar GIF animado
- perfil por servidor (rota legada/v0.9) tambem aceita GIF para avatar/banner
- emoji personalizado local preserva GIF animado em vez de converter o primeiro frame para WebP
- API valida MIME + assinatura real GIF87a/GIF89a e rejeita GIF com dimensoes abusivas
- limites: 8 MB para avatar/icone e 12 MB para banners
- imagens estaticas continuam sendo recortadas/otimizadas para WebP como antes

# Ginga 0.4.5 — Web Responsive Hotfix

- corrige landing publica em resolucoes intermediarias, onde o painel de login podia sair da viewport
- landing e login passam a empilhar antes de ficarem apertados, sem overflow horizontal
- downloads Windows/Linux continuam disponiveis e responsivos
- botao **Abrir no navegador** agora rola ate o formulario de login antes de focar o usuario
- cache do Service Worker rotacionado para `ginga-shell-v045` para evitar shell antigo apos a atualizacao
- adiciona protecoes de `min-width: 0` para grid/flex e evita que botoes Linux alarguem a pagina

# Ginga 0.4.3 RC9 — Linux + Voz Persistente + Forum

- categorias de canais voltam a recolher/expandir e persistem o estado por servidor
- Forum redesenhado com overlays corretos, filtros e hierarquia visual revisada
- Forum aceita banner e foto em PNG/JPG/WebP/GIF, preservando GIF animado
- notificacoes/toasts deixam de ser cortados pela titlebar do Desktop
- mini controle de voz persistente recebe compartilhamento de tela
- transmissao mostra quantidade de espectadores
- transmissor pode usar **Trocar janela** sem encerrar a transmissao nem derrubar quem esta assistindo
- botao **Encerrar transmissao** separado da troca de fonte
- distribuicao Linux x64: AppImage, DEB e RPM
- distribuicao Linux ARM64: AppImage e DEB
- site descobre manifests Linux e oferece botoes/downloads quando publicados
- Linux usa moldura nativa do sistema; titlebar customizada permanece exclusiva do Windows
- `build-linux.sh` e `release-linux.sh` usam Docker, sem Node obrigatorio no host

# Ginga 0.4.3 RC8 R1 — Build Fix

- corrige TS2304 de `composerFocused` / `setComposerFocused` em ChatView e DirectChat
- barra de formatacao continua contextual, visivel somente com foco no composer

# Ginga 0.4.3 RC8 - Settings polish

- grupos recolhiveis nas configuracoes de servidor e de perfil/usuario
- chevron e persistencia do estado recolhido
- espacamento e hierarquia visual refinados nas configuracoes
- toolbar de formatacao continua contextual e aparece somente ao focar o composer

# Ginga 0.4.3 RC7 - Composer contextual

- barra de formatacao fica escondida por padrao
- barra aparece somente quando o campo de mensagem recebe foco
- clicar nos botoes de formatacao nao fecha a barra
- comportamento aplicado em canais e mensagens diretas
- animacao curta sem alterar zoom/layout

# Ginga 0.4.3 RC6 — Chat QoL

- hyperlinks automaticos para URLs HTTP/HTTPS
- confirmacao de seguranca antes de abrir links externos
- Markdown seguro: negrito, italico, sublinhado, riscado, codigo e links
- toolbar de formatacao no chat e nas DMs com atalhos de teclado
- modo lento exposto na criacao/configuracao/menu do canal e contador no composer
- limpeza de historico por quantidade ou completa com auditoria e sincronizacao em tempo real
- comando administrativo `/clear 50` e `/clear all`
- tipografia base ampliada
- escala de texto configuravel de 90% a 140% sem alterar o zoom da aplicacao

# Ginga 0.4.3 RC5 — Self Roles & Reactions

- permite que quem possui `manageRoles` altere os próprios cargos personalizados
- mantém proteção de hierarquia/permissões ao alterar cargos
- novo visual profissional para reações
- tooltip mostra quem reagiu à mensagem
- payload de reações via Socket.IO alinhado com API/HTTP

# Ginga 0.4.3 RC4 — Media Viewer + Offline Members

- corrige **Abrir arquivo/imagem original** no Desktop: o Electron nao substitui mais a janela principal do Ginga pelo anexo; o original abre no navegador padrao
- evita o estado de UI ampliada/corrompida apos abrir anexos
- membros offline agora aparecem **somente** no grupo `Offline`, mesmo que possuam cargo marcado para exibicao separada
- grupos por cargo passam a conter apenas membros online; a hierarquia e a ordem dos cargos continuam valendo para os online
- mantem coroa do criador, cor do maior cargo no chat/perfil e voz neutra

# Ginga 0.4.3 RC3 — Roles & Members Polish

- lista de membros agrupada por cargo separado mais alto na hierarquia
- ordem dos grupos segue a ordem configurada em Cargos
- removido conceito visual de grupo Dono/Proprietario
- criador do servidor recebe coroa ao lado do nome
- grupos de membros podem ser recolhidos
- cor do maior cargo aplicada no chat e nos perfis, sem alterar voz
- icones de camera e compartilhamento de tela refeitos com Video/ScreenShare

# Ginga 0.4.3 RC2 - Member list polish

- lista de membros redesenhada para leitura proxima ao Discord
- fontes maiores na coluna de pessoas
- avatar e espacamento ajustados
- coluna de membros mais larga em desktop
- elimina sobreposicao provocada por chips de cargos no sidebar
- offline permanece legivel sem perder diferenciacao visual

## 0.4.3 - Release Candidate / UI Polish (2026-08-31)

- adicionada camada final `ui-release-v043.css` para estabilizar layout, tipografia, overflow, modais e foco por teclado;
- corrigido definitivamente o bloco lateral `Explorar`, inclusive em viewports compactos;
- UI otimizada para 1366x768, 1440x900 e 1536x864 em zoom 100%, sem `zoom` CSS ou `transform: scale()`;
- textos longos, links, anexos, imagens e videos passam a respeitar a largura do painel;
- nova aba **Configuracoes > Diagnostico** com Web/API/PostgreSQL/LiveKit/Socket.IO/armazenamento/Desktop/viewport e botao de copia para suporte;
- Desktop passa a persistir tamanho/posicao e limitar bounds a area util quando monitor, resolucao ou escala mudam;
- **Abrir com o Windows** ganha opcao complementar **Iniciar minimizado**;
- Service Worker rotacionado para cache `ginga-shell-v043`;
- novo `scripts/pre-release-check.sh` faz build real de API/Web e valida chave, versoes, Docker, Electron e UI antes da publicacao;
- `release-win.sh` bloqueia republicacao/downgrade acidental da mesma versao;
- documentos do bundle interno que usava o rotulo 0.9 foram marcados como historicos; a versao publica desta entrega e 0.4.3.

# Ginga 0.4.1 BIG FIX R2

- corrigido dimensionamento global da interface em 1440x900/1536x864 sem exigir zoom 80% do navegador
- sidebar, canais, membros, chat e cabecalhos passam a usar densidade compacta responsiva em viewports menores
- corrigido corte adicional de 32px no Desktop causado por dupla compensacao da titlebar
- painel de Personalizacao compactado para caber corretamente em telas de menor altura
- a correcao nao usa CSS zoom/transform, preservando coordenadas de menus contextuais e cliques

## 0.4.1 BIG FIX R1

- Corrige erro TypeScript TS2322 em `ServerUltimatePanel.tsx` durante o build Web.
- Mantem a union `Tab` corretamente tipada apos o filtro de permissoes das abas.

## 0.4.1 - BIG FIX + Community & Social (2026-08-31)

- **BIG FIX Desktop:** corrige altura/viewport para a tela de voz nao ficar cortada e os controles inferiores permanecerem visiveis.
- **Personalizacao refeita:** painel responsivo, permissoes por aba, dialogs internos compativeis com Electron e CRUD de areas/assets/onboarding/salas/badges.
- **Bandeja:** o comando `Sair` agora encerra janelas, timers e processo com fallback de encerramento forcado.
- **Abrir com o Windows:** opcao nas configuracoes do Desktop e checkbox direto no menu da bandeja.
- **Deploy seguro:** `apply-update-safe.sh` usa Python 3 para ler versoes e nao exige Node instalado no host Debian.
- Consolida a base 0.4.0 com personalizacao avancada de servidor e perfil.
- Areas, emojis/stickers, onboarding, badges, salas dinamicas e seguranca opt-in.
- Perfil social e infraestrutura de perfil por servidor, notas, mutuals, drafts e historico de edicoes.
- Desktop: deep links, autostart e crash reports, preservando o fix sandbox/preload da 0.4.0.
- PWA segura, Admin Health v2 e SDK JavaScript/TypeScript para bots.
- Novo sincronizador seguro para impedir rsync acidental de `/` para `/opt/ginga`.

## 0.4.0 - BIG Personalization + Desktop Recovery (2026-08-31)

- Corrigida a regressao que fazia o aplicativo Desktop parecer/renderizar como a Web: o preload sandboxed nao carrega mais modulo local via `require`, volta a expor `window.gingaDesktop` corretamente e restaura a chrome/titlebar nativa do Ginga.
- Desktop passa a marcar explicitamente o renderer com `data-ginga-desktop`, plataforma e classe de compatibilidade, mantendo os estilos Desktop ativos em builds atualizados.
- Zoom da janela principal do Electron e normalizado em 100% para impedir breakpoints de navegador causados por zoom persistido da mesma origem HTTPS; Ctrl +/-/0 nao altera mais a escala do app Desktop.
- Nova personalizacao visual por servidor: cor principal/secundaria, presets, barra lateral Solida/Tonalizada/Glass, densidade Confortavel/Compacta, enquadramento do banner e opcao de exibir banner sobre a lista de canais.
- Tema do servidor e aplicado somente quando aquele espaco esta selecionado, incluindo canal ativo, titulos, hover, voz e identidade no rail.
- Nova personalizacao de perfil: banner WebP otimizado, tema Aurora/Solido/Midnight, duas cores, enquadramento do banner, pronomes e ate 3 links publicos validados.
- Cards e perfil completo passam a renderizar banner/avatar personalizados, cores, pronomes, links e atividade de jogo.
- Migracoes de `GingaGuildAppearance` e `GingaGamingProfile` sao idempotentes; servidores existentes recebem as novas colunas automaticamente sem SQL manual.
- Pacotes root/API/Web/Desktop sincronizados na versao 0.4.0.

## 0.3.5 - Consolidacao funcional final (2026-08-30)
- Desktop consolidado com notificacoes nativas do Windows + fallback de bandeja, overlay atualizado, captura de tela, diagnostico de GPU/utility e sessao unica.
- Aceleracao de hardware permanece habilitada por padrao; `GINGA_DISABLE_HARDWARE_ACCELERATION=1` continua disponivel apenas como fallback de diagnostico.
- Scripts de release foram unificados com os do servidor, validam a versao publicada e evitam cache stale no feed de updates.
- Arquivos legados da antiga tela de configuracao de servidor foram removidos; o servidor oficial continua definido pela configuracao de branding/runtime atual.

## 0.3.5 - Branding readiness
- Runtime Desktop passa a concentrar nome publico, AUMID, produto do updater e prefixo do instalador em `src/brand.cjs`, mantendo todos os valores como Ginga.
- Nenhum nome, logo, titulo ou identificador de release foi alterado para outra marca.

## 0.3.5 - Functional Final
- Notificacoes Windows com fallback, recuperacao GPU/utility e captura/aceleracao revisadas.

## 0.3.5 - Desktop media compatibility (2026-08-29)

- Cliente Electron atualizado para 0.3.5.
- Mantem aceleracao de hardware/WebRTC ativa por padrao e registra diagnostico GPU no runtime log.
- Windows/Electron 43: cursor da captura e solicitado como sempre visivel no track da transmissao; Chromium 150 ja ativa WGC internamente e removeu o antigo toggle `AllowWgcWindowCapturer`, portanto nao usamos um switch ineficaz.
- `GINGA_DISABLE_HARDWARE_ACCELERATION=1` fornece fallback de diagnostico para drivers GPU problemáticos.
- Overlay Ctrl+Shift+O agora mostra avatar, camera, AO VIVO, mute/deafen e speaking.

# Pass 11 - estabilidade, voz sincronizada e mensagens

- Voz de servidor passa a usar um unico caminho de reproducao de audio remoto, evitando anexos duplicados e competicao entre players durante navegacao/reconexao.
- Highlight em tempo real na lista lateral para o usuario que esta falando, alimentado pelo Active Speaker do LiveKit.
- Reconexao automatica do LiveKit com token novo, reativacao de subscriptions e recuperacao do microfone quando a faixa local some ou encerra inesperadamente.
- Chamada privada (`MediaRoom`) recebe a mesma estrategia de reconexao, re-subscribe, audio unlock e watchdog de microfone.
- Presenca Socket.IO da voz e reconciliada periodicamente com a sala LiveKit; uma conta agora possui apenas uma sessao de voz ativa para eliminar sessoes fantasma entre Web/Desktop.
- Menu de usuario conectado na voz funciona por clique, `contextmenu` e fallback de botao direito por `pointerdown` no Desktop/Electron; mover, desconectar, conversar, ligar, expulsar e banir continuam validados no backend.
- LiveKit publico ganha ICE por TCP/UDP e TURN/UDP configuravel; o modo externo pode anunciar IP publico automaticamente. Instalacoes LAN continuam com defaults locais nos scripts de configuracao.
- Tela preta ganhou Error Boundary na raiz, captura de erros do renderer, log persistente no Desktop e recuperacao automatica se o renderer travar ou morrer.
- Mensagens ganharam barra de acoes com seletor de emoji para reacao, responder e encaminhar; o menu completo preserva copiar, link, salvar, arquivar, tarefa, fixar, editar e excluir conforme permissao.
- Encaminhamento de mensagem valida leitura da origem e escrita no destino e, nesta etapa, fica restrito a canais do mesmo servidor para nao vazar conteudo entre espacos.
- Icones de servidores dentro de pastas agora sao clipados e dimensionados no slot, impedindo avatar/logo gigante ao agrupar servidores.
- Novo `DIAGNOSTICO-VOZ-GINGA.cmd` mostra configuracao nao sensivel, estado/log do LiveKit, portas TCP locais e o `runtime.log` do Desktop.

# Pass 10 - Base de Conhecimento + landing Open Source

- Nova rota publica `/knowledge` com Base de Conhecimento pesquisavel e navegacao por categorias.
- Guias de primeiros passos, voz, Push-to-Talk, compartilhamento de tela, moderacao, Ginga Music, Developer Mode, bots Python, SDK, bibliotecas, YouTube API, seguranca e troubleshooting.
- Base de Conhecimento acessivel pela landing, pelo trilho principal do Ginga e pelo Developer Portal.
- Landing simplificada para remover aparencia de template: `Converse do seu jeito`, compartilhamento de tela explicito, Comunidades e Open Source.
- Removidas referencias de marketing a Self-Hosted e Bots em Python da landing publica.
- Botao de repositorio GitHub configuravel por `GITHUB_REPOSITORY_URL`, sem URL hardcoded.
- Docker Web recebe a URL do repositorio como build arg seguro do Vite.
- Novo `docs/BASE-DE-CONHECIMENTO.md`, `docs/OPEN-SOURCE-GITHUB.md` e `.env.example` para o exemplo de bot Python.

# Pass 9 - Ginga Music / voz: audio unico, som individual e menus de moderacao

- Ginga Music agora usa um unico motor de reproducao por usuario/servidor, com destruicao agressiva do player anterior, protecao contra corrida assincrona e autoplay desativado para evitar audio duplicado.
- Controles e inclusao/remocao de fila ganharam trava imediata contra clique duplo antes do React atualizar o estado visual.
- Novo lease de reproducao no backend impede a mesma conta aberta no Web + Desktop ou em navegadores diferentes de tocar a mesma faixa duas vezes.
- Volume e mute do Ginga Music sao individuais por usuario; o servidor guarda apenas o volume padrao usado na primeira configuracao local.
- Preferencias locais de musica ficam separadas por usuario e servidor.
- Busca ganhou campos independentes **Pesquisar no YouTube** e **Pesquisar no SoundCloud**.
- Busca SoundCloud usa credenciais `SOUNDCLOUD_CLIENT_ID` + `SOUNDCLOUD_CLIENT_SECRET`; links diretos continuam suportados.
- Corrigida exibicao duplicada de mute/deafen: a lista de voz renderiza somente um estado de audio por participante.
- Clique direito em usuario conectado na voz mantem acoes diretas de Conversar, Iniciar chamada, Desconectar, Mover, Expulsar e Banir, respeitando permissoes e hierarquia.
- A tela completa da chamada recebeu a mesma acao de Desconectar da voz e o mesmo fluxo de moderacao.

# Python Bots / Developer Platform

- bots de terceiros passam a ter Python 3.10+ como runtime oficial;
- novo SDK `ginga.py` com `from ginga.ext import commands`;
- API familiar com `commands.Bot`, `@bot.event`, `@bot.command`, `Context` e `Intents`;
- decorators sincronizam o catalogo de comandos do Developer Portal;
- Gateway ganhou intents `GUILDS`, `GUILD_MESSAGES`, `MESSAGE_CONTENT` e `VOICE_STATES`;
- conteudo de mensagem nao e entregue a bots sem intents explicitos;
- rooms de eventos de bots foram separadas das rooms de clientes humanos para metadados/voz;
- API de bot ganhou rate limits por aplicacao e o SDK respeita `Retry-After`;
- respostas de bot agora aceitam `replyToId`;
- Developer Portal foi alterado para fluxo Python-only e removeu cadastro manual de comandos;
- SDK/documentacao JavaScript para bots foram removidos; webhooks continuam agnosticos de linguagem;
- exemplo oficial de pesquisa do YouTube com `google-api-python-client` adicionado.

# 1.8.0-1beta - Auditoria de seguranca, contencao e UI unificada

## Ginga Music + UI/voz (pass 4)

- Ginga Music nativo por servidor, ativavel nas configuracoes.
- Fila sincronizada por Socket.IO com play, pause, anterior, pular, shuffle, repeat, limpar fila e volume.
- YouTube individual sem chave; busca e playlists via `YOUTUBE_API_KEY`; SoundCloud via widget oficial.
- Participante virtual `Ginga Music` exibido na arvore dos canais de voz.
- Rate limit e whitelist de provedores para evitar abuso/SSRF no resolvedor de links.
- Configuracoes de Voz e Video redesenhadas, com Atividade de voz / Push-to-Talk selecionaveis e teste real do microfone.
- Avisos claros quando o microfone some, perde permissao, fica indisponivel ou a faixa local de audio encerra.
- Clipboard com fallback para ambientes HTTP/Electron, corrigindo falhas como `Copiar ID do canal`.

## Seguranca e anti-abuso

- Uploads agora validam assinatura real (magic bytes) de imagens, audio, video, PDF e arquivos compactados, sem confiar apenas em extensao/MIME.
- Timeout de membros de 1 minuto a 28 dias, com motivo, desconexao de voz e auditoria.
- Novo **Modo de Contencao** para incidentes/raids: bloqueia mensagens, voz, novos joins e webhooks de membros comuns, mantendo a equipe administrativa operacional.
- Central de Seguranca do servidor com score, transporte, AutoMod, convites ilimitados, integracoes e recomendacoes acionaveis.
- Hierarquia de moderacao corrigida para cargos personalizados: um MEMBER com permissao de moderacao pode agir sobre MEMBER abaixo do seu cargo customizado, sem ultrapassar MODERATOR/ADMIN.
- Redis pode usar senha via `REDIS_PASSWORD`; containers Web/API e sinalizacao usam binds locais seguros por padrao.
- Runtime da API passou a read-only com `/tmp` isolado e `init: true`.
- Nginx recebeu limite de upload menor, X-Forwarded-For correto e CSP menos permissiva.
- Caddy recebeu HSTS e ocultacao do header Server.
- Novo `VALIDAR-SEGURANCA-GINGA.cmd` detecta HTTP/WS externo, chaves fracas, binds amplos, cadastro sem verificacao, Redis sem senha e inconsistencias de assinatura do updater.
- Novo exportador de fonte segura exclui `.env`, chaves privadas, `secrets`, builds, dados e artefatos publicados.

## Updater e configuracao

- O servidor do Desktop nao fica mais preso a um IP/link dentro dos scripts. O pipeline resolve `GINGA_SERVER_URL` e, como fallback, `APP_ORIGINS`.
- Feed remoto do updater agora diferencia indisponibilidade de divergencia de release e repete a verificacao antes de rollback.
- Fallback de desenvolvimento do Desktop usa somente `127.0.0.1`; builds de release gravam o endpoint resolvido.

## UI/UX e administracao

- Segunda passada das configuracoes: sidebar mais larga, labels sem quebra, tipografia maior, cards responsivos e acoes de moderacao separadas do seletor de cargo.
- Developer Portal reconstruido como tela React real (visao geral, aplicacoes, webhooks, SDK e documentacao), removendo a camada antiga que injetava formularios/guias via `MutationObserver`.
- Carregamento das abas administrativas agora isola falhas de API e mostra erro na propria pagina sem desmontar o modal.
- Conta/perfil receberam espacamento, contraste, formularios e cards mais consistentes com o restante do Ginga.
- Paleta reconstruida em grafite + violeta Ginga, removendo neon, gradientes soltos e azuis herdados sem funcao semantica.
- Configuracoes de servidor ganharam Central de Seguranca, contencao de emergencia e controles de timeout.
- Configuracoes de conta mostram estado real de HTTPS/WSS, cadastro e compatibilidade de webhooks.
- Verde/amarelo/vermelho ficam reservados a sucesso/alerta/perigo; violeta e o accent principal.

# 1.7.0-3beta — Comunidades, AFK e moderacao de voz

- Explorar Comunidades com cards, busca, categorias, tags e entrada direta.
- Servidor pode ser publicado/despublicado como comunidade nas configuracoes.
- Canal AFK `Ausente` automatico com timeout configuravel.
- Nova permissao `Mover membros` e movimentacao entre salas pelo clique direito.
- @mencoes clicaveis abrindo card de usuario.
- Correcao estrutural dos modais de perfil usando Portal, evitando tela preta/recorte.
- Migracao aditiva do banco para instalacoes existentes.

# Changelog

## 1.7.0-2beta - 2026-08-21

### Chamadas privadas e em grupo

- Chamada em DM agora toca e espera o destinatario atender ou recusar antes de abrir a sala de midia.
- Chamadas nao atendidas, recusadas, canceladas e encerradas aparecem na linha do tempo da conversa, junto das mensagens e na ordem cronologica.
- Chamadas encerradas registram a duracao; chamadas ativas exibem `Entrar na chamada`.
- Sair individualmente nao derruba a sala enquanto outra pessoa continua conectada.
- Chamadas ativas aceitam convite de amigos, lista de participantes e reentrada.
- O iniciador pode encerrar a chamada para todos; os demais podem apenas sair individualmente.

### Cargos e permissoes

- Editor de cargos reconstruido em formato de workbench inspirado no fluxo do Discord.
- Lista lateral de cargos com busca, contagem de membros, criacao rapida e drag-and-drop de hierarquia.
- Abas de Exibicao, Permissoes, Gerenciar membros e Acesso a canais.
- Paleta de cores, previa do cargo, presets de permissoes e busca de permissoes.
- Overrides de categoria/canal continuam usando Herdar, Permitir e Negar.

### Perfil, servidor e midia

- Usuario pode enviar, trocar e remover uma imagem de avatar.
- Servidor pode enviar, trocar e remover seu proprio icone.
- Imagens sao recortadas localmente em formato quadrado e enviadas em WebP otimizado.
- Avatares enviados passam a aparecer globalmente no app por cache/batch de URLs.
- Player de audio nativo foi substituido por um player Ginga com seek, tempo, volume e mute.

### Interface e Developer Platform

- Gradientes pretos foram reduzidos em favor de cinzas mais consistentes e superficies menos pesadas.
- Mencoes diretas, `@todos` e chips de marcacao receberam destaque mais forte e legivel.
- Developer Portal reorganizado com sidebar real, cabecalho, resumo de aplicacoes/webhooks/seguranca e cards mais consistentes.
- Guia do Developer Portal agora e injetado dentro da area de conteudo correta, sem quebrar o grid principal.

### Cadastro e erros

- Cadastro informa antes do envio que a senha precisa ter no minimo 8 caracteres.
- Requisito de senha possui feedback visual em tempo real e erro fica associado ao campo correto.
- E-mail e nome de usuario duplicados retornam mensagens especificas.
- Erros HTTP e de conexao possuem mensagens amigaveis; detalhes tecnicos continuam disponiveis para diagnostico quando enviados pela API.

## BIG UPDATE - 2026-08-21

### Primeiro acesso e cadastro

- Contas novas nao recebem mais servidor automatico.
- Onboarding inicial com `Criar servidor` e `Entrar com codigo de convite`.
- Ao sair do ultimo servidor, o usuario volta ao onboarding.
- Verificacao de e-mail temporariamente desativada por padrao com `EMAIL_VERIFICATION_REQUIRED=false`, mantendo o mecanismo pronto para reativacao.

### IDs, bots e desenvolvimento

- IDs persistentes do banco passam a ser expostos com `Copiar ID` para usuario, servidor, canal, conversa e mensagem.
- Menus de contexto foram revisados para uso com bots, webhooks e suporte.
- Script de versao aceita pre-releases como `1.7.0-1beta`, `1.7.0-beta.1` e `1.7.0-rc.2`.
- Updater Desktop compara release/pre-release sem depender de numeracao apenas `x.y.z`.

### UI, presenca e nao lidos

- Tema escuro clareado para uma faixa mais proxima de Discord moderno, preservando a identidade violeta/azul/ciano do Ginga.
- Fontes principais aumentadas e contraste revisado.
- Conteudo nao lido fica branco, mais grosso e com indicador; depois de abrir/marcar como lido volta ao estado normal.
- Badges de presenca agora sao circulares e cheios para Online, Ausente, Ocupado e Offline.

### News, Forum e Anuncios

- Ginga News refeita como central de releases, avisos e manutencao, com filtros, lido/nao lido e detalhes.
- Forum/Topicos redesenhado com busca, filtros, tags, ordenacao, contadores, estado de leitura e painel de discussao.
- Canais de Anuncios ganharam banner proprio, contagem de publicacoes e cards com destaque de comunicado.

### Pastas de servidores

- Pasta compacta/expandida mantem o comportamento de rail vertical.
- Botao direito no servidor oferece `Remover da pasta`.
- Ao arrastar um servidor que esta em pasta, aparece a zona `Solte aqui` para devolve-lo a barra normal.
- Desfazer uma pasta nao remove nem sai dos servidores.

### Organizacao do projeto

- Raiz limpa; ferramentas Windows de diagnostico/configuracao menos usadas foram movidas para `tools/windows/`.
- Caches de TypeScript e arquivos temporarios de validacao foram removidos do pacote.
- A chave privada do updater nao e redistribuida no ZIP.

## 1.5.6 - 2026-08-20

### Hotfix de build

- Corrigida a inferencia de tipo do `railItems` em `Workspace.tsx` que quebrava `tsc -b` no build Web.
- A rail agora usa a uniao discriminada `RailItem` e montagem explicita, sem `flatMap` ambiguo.
- Fontes Web e API revisadas por transpilation check apos o hotfix.

### Marca e interface

- Nova identidade visual oficial do Ginga aplicada a Web e Desktop: mascote roxo/azul/ciano aprovado, com fundo transparente.
- Favicon, icone do aplicativo, icone do Desktop e board de marca atualizados.
- Paleta principal refinada para violeta, azul e ciano sobre fundo grafite/azul-marinho.
- Login, botoes, foco, estados ativos e rail de servidores receberam acabamento coerente com a nova marca.

### QoL desta rodada

- Clique em usuarios abre card de perfil robusto por Portal.
- Pastas de servidores compactas e expansivas no estilo de rail vertical.
- Convite de servidor direto para amigos via DM, com card e botao `Entrar no servidor`.
- Botao direito em usuarios conectados na voz abre menu contextual estilo Discord.
- O menu de voz funciona tambem no proprio usuario (`voce`) e mantem clique esquerdo reservado para abrir perfil.
- Usuarios remotos na voz recebem acoes de perfil, mensagem, chamada, volume individual, silenciar localmente, cargos, copiar ID e moderacao conforme permissao.
- Expulsao e banimento pela voz usam confirmacao nativa do Ginga; banimento permite duracao e motivo.
- Botao direito em amigos abre perfil, DM, chamada, copiar identificadores e remover amizade.
- Menus contextuais agora usam Portal, reposicionamento automatico e acabamento coerente com a identidade violeta/azul/ciano.

## 1.5.0 - 2026-08-19

### Interface e identidade

- Interface redesenhada para uma linguagem escura, sobria e compacta, sem neon, paineis promocionais ou slogans ocupando area util.
- Trilho principal mostra somente o simbolo do Ginga no topo.
- Estados de hover/selecionado, espacamento, contraste e densidade revistos para uso diario.
- Templates e presets usam cores discretas e consistentes com a interface.
- Login, menus, modais, settings, updater e Desktop usam a marca Ginga.

### Mensagens e produtividade

- Barra poluida de acoes removida: cada mensagem mostra somente o botao `^` no hover.
- O mesmo menu pode ser aberto com clique direito.
- Acoes centralizadas: responder, reagir, copiar, salvar, arquivar, transformar em tarefa, fixar, editar e excluir conforme permissao.
- Templates rapidos de mensagem para anuncio, manutencao, atualizacao/changelog e boas-vindas.
- Mencoes `@usuario` com autocomplete de membros.
- `@todos` disponivel somente para quem possui a permissao correspondente.
- Mensagens que mencionam o usuario ou `@todos` recebem destaque visual discreto.

### Notificacoes e Windows

- Configuracoes independentes para DMs, mensagens do canal aberto, mencoes diretas, `@todos` e chamadas.
- Preferencias de previa do texto e som.
- Toast nativo do Windows com titulo e trecho da mensagem; fechamento automatico em aproximadamente 5 segundos.
- Clique no toast restaura e foca a janela do Ginga.
- Bandeja do Windows passou a usar o ICO/PNG real empacotado no aplicativo em vez de um fallback gerado em runtime.
- `AppUserModelId` fixo do Ginga para melhorar a integracao com notificacoes e atalhos do Windows.
- Fechar a janela continua mantendo o cliente conectado em segundo plano; o menu da bandeja permite abrir, recarregar servidor, configurar servidor ou sair.

### Templates e QoL

- Galeria sobria de templates de servidor: Essencial, Empresa, Comunidade, Suporte, Desenvolvimento, Estudos e Gaming.
- Presets de cargos: Observador, Colaborador, Moderacao, Gestao e Integracoes.
- Snapshots/modelos de servidor, simulador de permissoes, bookmarks, mensagens agendadas, auditoria e insights permanecem integrados.
- Token Web migra automaticamente das chaves legadas para `ginga.token`.
- Identidades internas novas de bots/webhooks passam a usar o namespace `*.ginga.local`.

### Compatibilidade

- Leitura dos caminhos/configuracoes legados Nexora/OrbitChat e mantida apenas para migracao silenciosa, sem exibir a marca antiga ao usuario.
- Web/API oficial continuam em `3090/TCP`.

## 1.0.0 - 2026-08-19

### Ginga - cargos profissionais

- Criacao e edicao completa de cargos personalizados.
- Nome, cor, icone/emoji, descricao, hierarquia, `Separar membros` e `@cargo` mencionavel.
- Reordenacao da hierarquia por drag-and-drop.
- Atribuicao de multiplos cargos diretamente no editor do cargo ou na lista de membros.
- Permissoes de servidor agrupadas por area.
- Overrides de categoria/canal com `Herdar`, `Permitir` e `Negar`.
- Canal pode herdar a categoria ou possuir excecao independente.
- Lista lateral de membros passa a separar automaticamente cargos marcados para destaque.
- Cor do cargo de maior hierarquia e aplicada ao nome do membro na lista.
- Navegacao de categorias/canais agora considera overrides de cargos personalizados.
- Hardening contra escalada: gestores de cargo nao podem atribuir/editar cargos que concedam privilegios que eles proprios nao possuem.


### Plataforma social

- Amigos e solicitacoes.
- Presenca online.
- Mensagens privadas 1:1 e chamadas privadas.
- Card de perfil clicavel e perfil completo.
- Perfis, privacidade, notificacoes, aparencia e seguranca separados por contexto.

### Mensagens

- Respostas, edicao, exclusao e reacoes.
- Mensagens fixadas.
- Busca textual.
- Bookmarks pessoais.
- Mensagens agendadas.
- Slow mode por canal.
- Mencoes administrativas condicionadas por permissao.

### Servidores

- Categorias persistentes.
- Drag-and-drop de categorias e canais.
- Menu de contexto para editar, mover e excluir.
- Texto, Voz, Anuncios, Forum e Eventos.
- Nome/cor/descricao/boas-vindas configuraveis.
- Links de convite navegaveis.

### Cargos e permissoes

- Cargos fixos Owner/Admin/Moderator/Member.
- Cargos personalizados com cor, icone/emoji, descricao, hoist e mentionable.
- Multiplos cargos por membro.
- Permissoes granulares de servidor.
- Overrides por categoria e canal.
- ACL aplicada no backend.
- Simulador de Permissoes com canais visiveis e acesso efetivo.

### Moderacao

- Kick.
- Ban 1h, 24h, 7d, 30d e permanente.
- Lista de banidos, motivo e desbanimento.
- Expiracao de ban temporario.
- Hierarquia de moderacao.
- Auditoria por servidor.
- AutoMod para palavras, spam de mencoes, links de convite e repeticao.

### Forum e Eventos

- Forum com topicos, tags, comentarios, busca, fixacao e fechamento.
- Eventos com RSVP, capacidade, local, inicio/fim e exportacao `.ics`.

### Voz/video

- Lista de usuarios abaixo da sala de voz.
- Microfone, camera e screen share via LiveKit.
- Seletor de tela/janela no Desktop.
- Audio de sistema quando suportado.
- Ping em ms.
- Stream ampliado/fullscreen e volume individual.

### Ginga Control

- `GINGA OWNER` global e irremovivel para a conta proprietaria da plataforma.
- GINGA ADMIN e DEV.
- Visao global de usuarios e privilegios.
- Frota de servidores com metricas basicas.
- Ginga News.
- Auditoria global da plataforma.

### Developer Platform - Web only

- Developer Portal exclusivo da Web.
- Aplicacoes, Client ID e identidade BOT.
- Token de bot com hash no servidor e exibicao somente na geracao/rotacao.
- Comandos de aplicacao.
- Links de instalacao/autorizacao.
- Permissoes por instalacao.
- Webhooks com token rotativo.
- Bot API HTTP + eventos Socket.IO.
- SDK Python inicial.
- Bots respeitam permissao de instalacao **e** ACL efetiva do canal.

### QoL Ginga

- Snapshot/modelo de servidor sem mensagens/segredos.
- Criar novo servidor a partir de snapshot.
- Simulador de permissoes.
- Bookmarks pessoais.
- Agendamento de mensagens.
- Insights operacionais.
- Servidor configuravel no Desktop sem recompilar.

### Desktop/updater

- Electron 1.0.0.
- Mini-updater antes da janela principal.
- Updater com manifesto Ed25519 e SHA-512.
- Configuracao persistente do servidor.
- Bandeja do Windows.
- Hardening de navegacao e permissoes.

### Rede

- Web/API padrao `3090/TCP`.
- Endpoint externo passou a ser configurado pelo ambiente, sem IP fixo no codigo.
- LAN `10.0.0.10:3090`.
- LiveKit `7880/TCP`, `7881/TCP`, `7882/UDP`.

### Seguranca

- JWT issuer/audience/jti/tokenVersion.
- Revogacao de sessoes.
- scrypt reforcado.
- lockout e rate limits especializados.
- permissoes no backend.
- auditoria com hash HMAC do IP quando aplicavel.
- quotas/allowlist de upload.
- PostgreSQL/Redis sem publicacao de portas.
- API sem root no runtime e `no-new-privileges`.
- tokens de bots/webhooks armazenados como hash.
- bot/webhook nao autentica como conta humana.

## 0.6.0 - 2026-08-18

- Base de categorias, permissoes, moderacao e tipos de canal.
- IP externo configuravel.
- Hardening inicial de sessao/API.
- Updater assinado Ed25519.

## 0.5.0 - 2026-08-18

- Mini-updater inicial.
- Screen share aprimorado, ping e player de transmissao.

## Pass 6 - Modo Desenvolvedor e IDs estaveis

- Nova aba **Configuracoes > Desenvolvedor** com toggle de Modo Desenvolvedor.
- Acoes **Copiar ID** ficam ocultas no uso normal e aparecem quando o modo esta ativo.
- IDs de usuario, servidor, canal, categoria, conversa, mensagem, topico e cargo expostos de forma consistente.
- Cargos personalizados continuam usando o ID persistente do banco; renomear/cor/permissoes nao altera o ID.
- Cargos internos agora possuem IDs deterministas por servidor (`grole:<guildId>:owner|admin|moderator|member`).
- Bot API passa a expor roles nos guilds e consultas por ID de canal, usuario, membro e cargo.
- `ginga.py` 2.1 adiciona `get_channel`, `fetch_channel`, `get_role`, `fetch_role`, `fetch_user` e `fetch_member`.

## Pass 7 - Admin, implantacao de bots e perfil Web

- Console administrativo refeito com navegacao por Visao geral, Usuarios, Servidores, Comunicados e Auditoria.
- Dashboard administrativo ganhou metricas, saude da plataforma, contas privilegiadas e atividade recente.
- Tela de instalacao OAuth de bots refeita com servidor, grupos de permissoes, resumo e confirmacao explicita.
- Card de instalacao no Developer Portal ganhou presets Essencial, Chat e Voz e descricoes por permissao.
- Perfil Web agora fica isolado por Error Boundary para impedir tela preta no restante do Ginga.
- Perfil e popover toleram payload incompleto, campos ausentes e datas invalidas sem derrubar o React.
- Estados de loading e erro parcial foram adicionados ao perfil com opcao de tentar novamente.

## Pass 8 - Menus de contexto e moderacao de voz

- Menu de contexto do servidor ampliado: marcar como lido, convidar, silenciar, preferencias de notificacao, ocultar canais silenciados, privacidade, eventos, integracoes, sair e copiar ID em Modo Desenvolvedor.
- Preferencias locais por servidor/canal para mute e ocultacao de canais silenciados.
- Clique esquerdo ou direito em usuario conectado na sidebar de voz abre menu operacional com perfil, DM, chamada, desconectar da voz, mover de sala, expulsar e banir conforme permissoes.
- Corrigido o alvo da opcao "Mover para": agora usa a sala real em que o usuario esta, nao o canal atualmente selecionado na interface.
- Ginga Music ganhou menu de contexto proprio: abrir player, mover entre salas, desconectar da voz, configurar e copiar ID fixo no Modo Desenvolvedor.
- Novo evento de moderacao `voice:disconnect-member`, validado no servidor por hierarquia/permissao e com remocao do participante do backend de midia.
- Novo endpoint seguro para sair de um servidor; proprietario nao pode sair acidentalmente.
- Ao sair de um servidor, as conexoes do usuario sao removidas das rooms Socket.IO daquele servidor/canais sem derrubar a sessao inteira do Ginga.
