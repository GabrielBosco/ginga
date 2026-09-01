# Contribuindo

Obrigado pelo interesse no Ginga.

## Antes de enviar código

1. trabalhe em uma branch separada;
2. mantenha alterações focadas e revisáveis;
3. não inclua `.env`, chaves, tokens, backups ou artefatos de build;
4. mantenha Root/API/Web/Desktop com versão coerente quando a mudança fizer parte de uma release;
5. rode o gate do repositório:

```bash
./scripts/prepare-github.sh
```

Para validar builds via Docker quando disponível:

```bash
./scripts/prepare-github.sh --build
```

## API

```bash
cd apps/api
npm ci
npx prisma generate
npm run build
```

## Web

```bash
cd apps/web
npm ci
npm run build
```

## Commits

Use mensagens curtas que expliquem a intenção, por exemplo:

```text
fix: corrige upload de GIF no perfil
feat: adiciona suporte a pacote Linux
release: Ginga v0.4.8
```
