# Ginga 0.4.3 RC9 — Linux, Voz Persistente e Forum

Esta RC fecha as regressoes reportadas depois da RC8 e prepara o mesmo cliente Electron para distribuicao Linux.

## Categorias de canais

- categorias voltam a recolher/expandir pelo chevron;
- estado recolhido e salvo localmente por servidor;
- criar canal e drag-and-drop continuam disponiveis;
- recolher uma categoria nao apaga nem reordena canais.

## Forum

O Forum recebeu uma revisao visual e funcional:

- header mais limpo;
- filtros, busca, ordenacao e tags reorganizados;
- criacao e detalhes em overlays reais, sem painel preso no rodape;
- banner proprio do forum;
- foto/icone proprio do forum;
- PNG, JPG, WebP e GIF;
- GIF e armazenado sem conversao e permanece animado;
- limite de 4 MB para foto e 10 MB para banner;
- alteracoes de aparencia sincronizadas por Socket.IO.

## Notificacoes

Toasts agora respeitam a titlebar customizada do Windows e ficam acima do conteudo, sem serem cortados. Linux usa a moldura nativa do sistema e nao recebe o offset de 32 px do Windows.

## Voz persistente

Ao permanecer numa sala de voz e navegar para um canal de texto, o mini painel inferior agora oferece:

- microfone;
- ensurdecer;
- compartilhar tela;
- configuracoes;
- desconectar.

Durante uma transmissao, o controle de tela mostra:

- numero de espectadores;
- `Trocar janela`;
- `Encerrar transmissao`.

`Trocar janela` substitui a MediaStreamTrack do compartilhamento existente via LiveKit, sem encerrar a publicacao. Assim, quem ja esta assistindo permanece na mesma transmissao.

O contador considera usuarios que abriram efetivamente a transmissao. O proprio transmissor nao e contado.

## Linux

Targets preparados:

### x64 (Intel/AMD 64 bits)

- AppImage;
- `.deb`;
- `.rpm`.

### ARM64

- AppImage;
- `.deb`.

Nao e oferecido Linux PC x86/ia32 de 32 bits. A linha atual do Electron usada pelo Ginga deve ser distribuida para Linux x64 ou ARM64.

Preflight Linux (nao compara o feed Windows):

```bash
cd /opt/ginga-build
./scripts/pre-release-check.sh 0.4.3 --linux
```

Build sem Node instalado no host:

```bash
cd /opt/ginga-build
./build-linux.sh x64
```

Release x64:

```bash
./release-linux.sh 0.4.3 --x64
```

Release x64 + ARM64:

```bash
./release-linux.sh 0.4.3 --all
```

O build usa por padrao `electronuserland/builder:22` via Docker.

Os artefatos sao publicados em:

```text
/opt/ginga/updates/linux/x64/
/opt/ginga/updates/linux/arm64/
```

A Web consulta os manifests e exibe os downloads automaticamente quando os arquivos existem.

### Observacao sobre atualizacao automatica no Linux

Nesta RC, o updater automatico interno continua habilitado apenas no Windows. Linux recebe os pacotes completos e o feed de download pelo site. Isso evita apontar clientes Linux para o feed NSIS/Windows durante a primeira distribuicao. Um updater Linux dedicado pode ser habilitado depois de validar AppImage/DEB em producao.

## Compatibilidade de janela no Linux

O Windows continua usando a titlebar customizada do Ginga. Em Linux/macOS, o Electron agora mantem a moldura nativa do sistema, sem injetar uma segunda barra de titulo nem descontar 32 px adicionais do viewport.
