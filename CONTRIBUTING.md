# Contribuindo com o Ginga

Valeu por querer melhorar o projeto.

O Ginga é um projeto brasileiro e a documentação oficial é mantida em **português do Brasil**. Nomes de APIs, bibliotecas, protocolos e identificadores de código permanecem no formato técnico original quando necessário.

## Antes de começar

Para bugs, abra uma Issue com:

- versão do Ginga;
- componente afetado;
- passos mínimos para reproduzir;
- resultado esperado;
- resultado atual;
- logs relevantes sem segredos ou dados pessoais.

Para alterações grandes de arquitetura, banco ou experiência de uso, prefira discutir a proposta antes de escrever um Pull Request enorme.

## Ambiente de desenvolvimento

API:

```bash
cd apps/api
npm install
npm run build
```

Web:

```bash
cd apps/web
npm install
npm run build
```

Stack completa:

```bash
./scripts/init.sh
docker compose up -d --build
```

## Pull Requests

- mantenha cada PR focado em um problema ou funcionalidade;
- não inclua `.env`, `node_modules`, `dist`, backups ou binários;
- não adicione IP, domínio ou endpoint específico da sua instalação;
- preserve a instalação auto-hospedada genérica;
- explique qualquer mudança de banco, configuração, segurança ou compatibilidade;
- valide API e Web antes de enviar;
- escreva documentação e textos visíveis ao usuário em pt-BR.

Antes do envio, execute:

```bash
./scripts/prepare-github.sh --build
```

## Estilo do projeto

Priorize:

- código simples de entender;
- validação no backend;
- mensagens de erro úteis;
- falhas seguras por padrão;
- interface responsiva;
- compatibilidade com instalação própria;
- documentação objetiva e reproduzível.
