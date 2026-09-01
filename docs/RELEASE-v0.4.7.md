# Ginga 0.4.7 — Stability + Soundboard

## Objetivo

A primeira entrega da série 0.4.7 melhora a base de voz e introduz um Soundboard nativo por servidor. O som não depende da tela `VoiceRoom`: a reprodução usa a sessão de voz persistente, portanto continua funcionando enquanto o usuário navega pelo restante do Ginga.

## Soundboard

### Usuário

- botão **Sons** na barra de controles da chamada e no mini-card de voz persistente;
- busca instantânea;
- favoritos locais por servidor;
- controle de volume 0–100%;
- indicação visual de quem tocou e qual som foi reproduzido;
- animação do card acompanha o playback real do clip;
- o som respeita ensurdecimento e saída de áudio selecionada.

### Gestão

Owner/admin pode adicionar e remover sons diretamente pelo painel. Formatos aceitos:

- MP3;
- WAV;
- OGG;
- WebM Audio;
- M4A/MP4 Audio;
- AAC.

Limites iniciais:

- 48 sons por servidor;
- 2 MB por arquivo;
- 12 segundos por som.

### Segurança e anti-spam

- assinatura binária do áudio é validada pela API;
- o usuário precisa estar realmente conectado no canal de voz informado;
- máximo de 6 tentativas em 10 segundos por cliente;
- intervalo mínimo de 700 ms por usuário;
- intervalo mínimo de 500 ms para a sala inteira;
- usuários ensurdecidos não recebem o evento de reprodução.

## Implementação

- `apps/web/src/components/SoundboardPanel.tsx` — UI, busca, favoritos e upload;
- `apps/web/src/lib/soundboard.ts` — preferências, tipos e validação cliente;
- `apps/web/src/components/PersistentVoiceAudio.tsx` — playback persistente;
- `apps/api/src/routes/v090.ts` — biblioteca/asset do servidor;
- `apps/api/src/socket.ts` — sincronização da reprodução;
- `apps/api/src/v090Storage.ts` — tabela `GingaGuildSoundboardSound`;
- `apps/web/src/ui-v047.css` — painel e estados visuais.

## Validação de release

```bash
cd /opt/ginga-build
./scripts/pre-release-check.sh 0.4.7 --all
./release-all.sh 0.4.7 --all
```


## Auth / Login hotfix

Antes da publicacao final da 0.4.7, o login recebeu uma rodada adicional:

- sessao lembrada por ate 30 dias com refresh cookie HTTP-only rotativo;
- restauracao automatica ao abrir Web/Desktop e apos expiracao do access token;
- logout revoga a sessao persistente;
- entrada de recuperacao por 2FA para usuario que esqueceu a senha;
- rate limit dedicado e resposta sem enumeracao de conta;
- redesign completo da tela de autenticacao e da pagina de redefinicao;
- cache da PWA rotacionado para evitar landing/login antigos.


## Final UI/Auth + Stability Fix

A publicacao final da 0.4.7 recebeu uma camada de isolamento para a autenticacao (`auth-v047-r2.css`). Ela evita que CSS legado das releases 0.4.3–0.4.6 altere o layout da landing/login em breakpoints intermediarios.

Breakpoints finais:

- desktop: hero e login em duas colunas;
- notebook/tablet: login primeiro, hero secundario abaixo;
- celular: login compacto em uma coluna, links/downloads adaptados e safe area;
- celular pequeno: espacamento e tipografia reduzidos sem diminuir os campos abaixo do tamanho de toque.

O estado de mensagens nao lidas tambem passa a persistir localmente por usuario (`lib/unreadState.ts`), mantendo canais, DMs e mencoes depois de recarregar o cliente.

O Service Worker usa `ginga-shell-v047-auth3-ui`, forcando a retirada dos shells antigos depois da atualizacao.


A tela de Configuracoes tambem recebeu um layout mobile unico. Abaixo de 820 px, as abas ficam em uma faixa horizontal rolavel no topo e os grupos nao podem permanecer recolhidos a ponto de esconder opcoes no celular. Formularios e grids administrativos passam para uma coluna conforme a largura.

## Dark landing + downloads Linux

A landing da 0.4.7 agora possui fundo dark nativo e solido. A camada anterior deixava o shell principal transparente e podia revelar o fundo branco do documento. A nova camada `auth-v047-r3.css` tambem redesenha os downloads Linux: x64 oferece AppImage/DEB/RPM e ARM64 oferece AppImage/DEB em botoes separados, com layout proprio para celular. O cache da PWA foi rotacionado para `ginga-shell-v047-auth4-dark-downloads`.


## Overlay de jogo — fechamento final

A sobreposicao do Desktop foi ligada de ponta a ponta antes da publicacao final da 0.4.7:

- deteccao continua limitada a executaveis de jogos conhecidos, mas agora identifica tambem a janela reconhecida e o estado de foco;
- a janela transparente acompanha o retangulo/monitor do jogo, reaplica `alwaysOnTop` e permanece click-through;
- ao usar Alt+Tab, a camada e escondida para nao ficar sobre navegador/desktop e volta automaticamente ao retornar ao jogo;
- `Ctrl + Shift + O` mostra/oculta durante o jogo e abre uma previa curta quando nenhum jogo esta detectado;
- participantes agora enviam para a overlay estado real de fala, microfone, deaf, camera e compartilhamento de tela;
- a configuracao local da overlay nao depende mais da API de presenca publica: falha em `/api/gaming-profile/me` gera aviso, mas nao bloqueia deteccao, preview ou configuracoes locais;
- painel de configuracoes mostra estado do runtime (pronta, ativa, jogo em segundo plano, oculta por atalho ou aguardando chamada);
- cache da PWA rotacionado para `ginga-shell-v047-overlay-final`.

A camada usa uma janela nativa transparente do Electron e nao injeta DLL/codigo no processo do jogo. Em Windows, o alvo suportado e jogo em janela ou janela sem borda. Fullscreen exclusivo e alguns anti-cheats podem impedir overlays externas por design.
