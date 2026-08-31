# Ginga v0.3.5 - voz, camera, live, sincronizacao e mobile

Base: v0.3.4 + hotfix de fullscreen de compartilhamento de tela.

## Salas de voz (prioridade desta versao)
- Estado de voz sincronizado e reapresentado periodicamente para reparar eventos perdidos em reconnect/hibernacao/restart da API.
- Lista completa de membros do servidor e atualizada novamente a cada 20 s enquanto visivel, no reconnect e ao voltar para a aba, curando membros ausentes entre clientes.
- Reset do contador de revisao de presenca ao reconectar, evitando clientes ignorarem snapshots validos depois de restart do servidor.
- Membros, mute, ensurdecimento, camera e transmissao fazem parte do mesmo snapshot autoritativo.
- Indicadores independentes de microfone mutado e som/ensurdecimento tanto na sidebar quanto dentro da sala.
- Badges clicaveis `AO VIVO` e `CAMERA` na sidebar e nos participantes.
- Reparo automatico da sessao de voz via `voice:sync` a cada 15 s e ao voltar da rede.

## Camera e transmissao estilo Discord
- Clique numa camera/transmissao para deixa-la como midia principal.
- Midia principal centralizada com participantes em filmstrip lateral; em telas menores o filmstrip vira uma faixa horizontal inferior.
- Troca da midia principal sem sair da chamada.
- Fullscreen aplicado somente ao palco principal, preservando o hotfix da v0.3.4.
- Controle de volume do audio compartilhado quando a transmissao possui audio.
- Controles globais de mic, camera, troca de camera, tela, som/deafen, qualidade e desligar continuam abaixo do palco.
- Cameras frontal/traseira no mobile via `facingMode`, com fallback por deviceId quando o navegador fornece nomes dos dispositivos.

## Mobile/responsividade
- Layout da sala de voz adaptado para 900/720/480 px.
- Filmstrip passa para baixo no mobile.
- Controles de voz ficam rolaveis horizontalmente e respeitam safe-area.
- Grade de participantes deixa de espremer todas as cameras em cards minimos.

## Sessao unica Web/Desktop/Celular
- Login detecta uma sessao recente ja ativa e retorna qual tipo de cliente esta conectado.
- Tela oferece `Usar aqui`; ao confirmar, as sessoes anteriores sao revogadas.
- Cliente anterior recebe `auth:session-replaced` e sai imediatamente em vez de disputar Socket.IO/voz com o novo cliente.
- Sessao atual possui keepalive/validacao no Socket.IO e logout explicito revoga o SID atual.

## Perfil/avatar
- Avatar atualizado aparece nos componentes que usam `Avatar`, incluindo sidebar e sala de voz.
- Atualizacoes remotas de perfil sao propagadas para o cache global e para o runtime do overlay.
- Payload enviado ao overlay inclui avatar, camera e compartilhamento de tela por participante.
- Perfil suporta ate 5 links publicos HTTP/HTTPS com nome personalizado.

> Nota: o ZIP de fonte enviado para esta correcao nao continha `apps/desktop` (Electron/renderer nativo). O Web envia os novos campos ao bridge do overlay, mas para redesenhar o overlay nativo em si e necessario aplicar a parte Electron no repositorio de build desktop quando ele estiver disponivel.

## Links externos em mensagens
- URLs `http://`, `https://` e `www.` em canais e DMs ficam clicaveis.
- O Ginga identifica visualmente como link externo e pede confirmacao mostrando o dominio antes de abrir.
- No wrapper Android, a navegacao externa segue para o navegador do aparelho.

## Banco de dados
- `GingaGamingProfile.profile_links` e criado/migrado de forma idempotente pela API.
- O Prisma schema tambem contem `profileLinks Json @default("[]")`.

## Atualizacao sugerida no Debian 13

Depois de substituir o fonte:

```bash
cd /opt/ginga
docker compose build api web
docker compose up -d --force-recreate api web
docker compose ps
```

Nao e necessario reiniciar o Debian inteiro.
## Personalizacao de perfil - 0.3.5
- Capa/banner proprio com upload e remocao.
- Cores primaria/secundaria para a identidade do card.
- Temas: Classico, Glass, Midnight, Aurora e Minimal.
- Molduras: sem moldura, solida, dupla, glow e tracejada.
- Efeitos: sem efeito, spotlight, pulso e shimmer; `prefers-reduced-motion` desativa animacoes.
- Pronome e emoji de status opcionais.
- Ate cinco links publicos HTTP/HTTPS; abertura continua pedindo confirmacao de link externo.
- Preview ao vivo nas configuracoes e o mesmo visual no card rapido/perfil completo.
- Estrutura `branding/` e `apps/web/src/branding/` criada para um rebrand futuro, sem trocar o nome Ginga agora.

