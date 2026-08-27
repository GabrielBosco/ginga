# Publicando o Ginga no GitHub

## Antes do primeiro envio

Execute a verificação de segurança do repositório:

```bash
./scripts/prepare-github.sh
```

Para também compilar API e Web:

```bash
./scripts/prepare-github.sh --build
```

O comando deve terminar sem `FAIL`.

## Criar um repositório novo

Crie um repositório vazio no GitHub, sem adicionar README ou licença pelo site. Depois:

```bash
git init
git add .
git commit -m "feat: primeira versão pública 0.2.0"
git branch -M main
git remote add origin git@github.com:SEU_USUARIO/ginga.git
git push -u origin main
```

Crie a tag da versão:

```bash
git tag -a v0.2.0 -m "Ginga 0.2.0"
git push origin v0.2.0
```

Se preferir autenticação HTTPS:

```bash
git remote add origin https://github.com/SEU_USUARIO/ginga.git
```

## Repositório existente

Confira o endereço remoto:

```bash
git remote -v
```

Para trocar:

```bash
git remote set-url origin git@github.com:SEU_USUARIO/ginga.git
```

Depois:

```bash
git add .
git commit -m "release: Ginga 0.2.0"
git push origin main
```

## Configurações recomendadas no GitHub

Ative, quando disponíveis:

- Issues;
- Discussions para a comunidade;
- relato privado de vulnerabilidades;
- alertas do Dependabot;
- proteção contra envio de segredos;
- regras de proteção para a branch `main` quando houver mais contribuidores.

Tópicos sugeridos:

```text
ginga
brasil
open-source
self-hosted
chat
webrtc
voice-chat
community
react
typescript
nodejs
postgresql
redis
livekit
electron
docker
```

Descrição curta sugerida:

> Plataforma brasileira, de código aberto e auto-hospedada para comunidades, com chat em tempo real, voz, vídeo, moderação, bots e clientes Desktop/Android.

## Releases

Não coloque instaladores `.exe` ou `.apk` diretamente no histórico Git. Publique esses binários na área **Releases** do GitHub.

Exemplos:

```text
Ginga-Setup-0.2.0-x64.exe
Ginga-0.2.0-debug.apk
```
