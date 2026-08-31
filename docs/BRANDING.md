# Branding do Desktop

A 0.4.0 continua com a marca **Ginga**. Os novos arquivos de branding apenas reduzem o acoplamento para uma troca futura de identidade.

## Fonte de verdade em runtime

`apps/desktop/src/brand.cjs`

O `main.cjs` usa esse modulo para nome do aplicativo, AUMID, produto esperado pelo manifesto do updater, prefixo do instalador e titulos padrao de notificacao.

## Build/installer

O `package.json` e o `release-win.sh` ainda contem metadados de empacotamento Ginga por seguranca de compatibilidade com a cadeia de updater existente. Em um rebrand futuro eles devem ser migrados juntos e nunca trocados isoladamente.

## Nao renomear automaticamente

- IPC/eventos `ginga:*`;
- arquivos de sessao/config existentes;
- AUMID/appId em clientes ja instalados sem plano de migracao;
- produto/nome do arquivo no manifesto assinado sem compatibilidade com clientes antigos.
