# Ginga 0.4.3 RC1 — checklist de lançamento

A 0.4.3 RC1 e uma release de estabilizacao. O objetivo e publicar o bundle funcional ja existente com interface previsivel, Desktop recuperavel e uma esteira que bloqueie erros conhecidos antes do EXE chegar aos usuarios.

## Mudancas desta RC

### UI / CSS

- `ui-release-v043.css` e carregado por ultimo e funciona como camada de guardrails da release.
- Corrige definitivamente o estado lateral **Explorar**, evitando titulo/descricao sobrepostos.
- Preserva a geometria compacta criada para 1366x768, 1440x900 e 1536x864 sem usar `zoom` ou `transform: scale()`.
- Tipografia de chat, canais, membros, menus e configuracoes continua legivel em zoom 100%.
- URLs, anexos, imagens, videos e textos longos nao podem aumentar a largura do shell.
- Modais respeitam `100dvh` e permanecem rolaveis em telas de notebook.
- `focus-visible` fica consistente para uso por teclado.
- Respeita `prefers-reduced-motion`.

### Desktop

- Mantem o encerramento forte do comando **Sair** da bandeja.
- Mantem **Abrir com o Windows**.
- Adiciona **Iniciar minimizado com o Windows**.
- Persiste posicao/tamanho da janela.
- Ao trocar monitor, resolucao ou escala do Windows, bounds salvos sao limitados a area util do monitor atual para evitar janela parcialmente fora da tela.
- O zoom do Electron permanece em 100%.

### Diagnostico

Nova aba `Configuracoes > Diagnostico` mostra, sem expor credenciais:

- versao Web e API;
- latencia HTTP;
- PostgreSQL;
- LiveKit;
- Socket.IO do cliente;
- armazenamento;
- uptime da API;
- viewport e DPR;
- versao/plataforma do Desktop;
- Electron/Chromium;
- zoom da janela;
- escala e area util do monitor;
- autostart e canal do updater.

O botao **Copiar diagnostico** gera texto pronto para o usuario enviar ao suporte. Senha, token de sessao, segredo 2FA e conteudo de mensagens nao sao incluidos.

### Updater / release

- `release-win.sh` recusa republicar ou fazer downgrade sobre uma versao que ja esta no `manifest.json`.
- `GINGA_ALLOW_REPUBLISH=1` existe somente para recuperacao excepcional e gera aviso explicito.
- assinatura Ed25519, fingerprint fixa, SHA-512, `latest.yml`, manifest assinado e publicacao atomica continuam preservados.
- o cache PWA foi rotacionado para `ginga-shell-v043` para remover o shell historico antigo na ativacao do novo Service Worker.

## Gate obrigatorio antes de publicar

Depois de aplicar o source em `/opt/ginga` e `/opt/ginga-build`, execute:

```bash
cd /opt/ginga-build
./scripts/pre-release-check.sh 0.4.3
```

O gate verifica:

1. versoes Root/API/Web/Desktop;
2. existencia do `.env` e da `private.pem` original;
3. se 0.4.3 e maior que a versao atualmente publicada;
4. espaco livre minimo;
5. `bash -n` nos scripts;
6. `docker compose config`;
7. `node --check` no Electron/preload/signer usando Docker;
8. continuidade da chave Ed25519;
9. build real de API e Web, sem reiniciar producao;
10. existencia/import da camada final de CSS;
11. ausencia de rotulo publico `0.9` na UI;
12. health do runtime atual quando disponivel.

Somente depois de aparecer:

```text
GINGA 0.4.3 APTO PARA PUBLICACAO
```

rode:

```bash
./release-win.sh 0.4.3
```

Nunca use `--init-key` numa cadeia que ja possui clientes instalados.

## RC6 — Chat QoL

Antes da publicacao final, validar adicionalmente:

- URL crua vira hyperlink e pede confirmacao para dominio externo;
- `[texto](https://destino)` funciona sem exibir a URL inteira;
- B/I/U/codigo/link funcionam pela toolbar e atalhos;
- `/clear 10` remove somente as ultimas 10 mensagens;
- `/clear all` exige confirmacao e limpa o canal;
- outro cliente conectado recebe a limpeza sem recarregar;
- modo lento bloqueia spam de membro e mostra contagem regressiva;
- owner/admin/quem gerencia mensagens continua isento conforme backend;
- Aparencia > Escala do texto funciona em 100/110/120/130/140 sem usar zoom do navegador.

## RC9 — Linux, Forum e voz persistente

Validar antes da release final:

- chevron recolhe e expande todas as categorias de canais;
- Forum nao fica preso no rodape e os overlays cabem no viewport;
- GIF de banner e foto do Forum permanece animado depois do upload;
- toast de voz/notificacao nao entra embaixo da titlebar;
- mini painel de voz aparece ao navegar para texto e permite iniciar compartilhamento;
- transmissor ve a quantidade de espectadores;
- `Trocar janela` mantem a mesma transmissao aberta para quem esta assistindo;
- `Encerrar transmissao` finaliza normalmente;
- `./release-linux.sh 0.4.3 --x64` gera/publica AppImage, DEB e RPM;
- site mostra Linux x64 quando o manifest existe;
- opcionalmente, `--all` valida tambem AppImage/DEB ARM64.
