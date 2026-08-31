# Ginga 0.4.0 - BIG Personalization + Desktop Recovery

## Correcao critica do Desktop

A regressao visual era causada pelo preload do Electron. O BrowserWindow continua com `sandbox: true` por seguranca, mas o preload tentava executar `require('./brand.cjs')`. Em preload sandboxed, esse modulo local nao pode ser carregado. O script abortava antes de expor `window.gingaDesktop` e antes de instalar a chrome do Desktop; por isso o React identificava a sessao como Web.

A 0.4.0 passa o nome da marca pelo `additionalArguments` do BrowserWindow, remove o `require` local do preload, restaura os marcadores Desktop e fixa a escala da janela em 100%.

## Personalizacao de servidor

Em **Gerenciar espaco > Aparencia** o administrador pode definir:

- cor principal e secundaria;
- presets Ginga, Oceano, Esmeralda, Solar e Mono;
- barra lateral Solida, Tonalizada ou Glass;
- densidade Confortavel ou Compacta;
- posicao vertical do banner;
- exibicao do banner no topo da lista de canais.

As configuracoes ficam no `GingaGuildAppearance` e sao aplicadas somente ao servidor ativo.

## Personalizacao de perfil

Em **Configuracoes do usuario > Perfil** o usuario pode definir:

- avatar e banner;
- tema Aurora, Solido ou Midnight;
- cor principal e secundaria;
- recado e Sobre mim;
- pronomes opcionais;
- ate 3 links publicos;
- enquadramento vertical do banner.

O banner e convertido localmente para WebP 1600x600 antes do upload. As URLs de perfil passam por validacao no backend.

## Banco de dados

Nao e necessario executar migracao SQL manual. As tabelas auxiliares usam `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS`, normalizam dados legados e preservam as configuracoes existentes.
