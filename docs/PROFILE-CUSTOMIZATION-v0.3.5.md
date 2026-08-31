# Perfil personalizado - Ginga 0.3.5

## Recursos

- avatar com conversao WebP;
- banner/capa panoramica com conversao WebP;
- duas cores de destaque;
- temas Classico, Glass, Midnight, Aurora e Minimal;
- molduras de avatar Solida, Dupla, Glow e Tracejada;
- efeitos Spotlight, Pulso e Shimmer;
- pronome e emoji de status opcionais;
- recado, bio e ate cinco links publicos;
- preview ao vivo no editor;
- visual consistente no card rapido e no perfil completo.

## Banco

A API cria as novas colunas de `GingaGamingProfile` de forma idempotente via `ADD COLUMN IF NOT EXISTS`, portanto o deploy nao exige derrubar o banco.

## Seguranca de links

A API aceita apenas URLs `http://` ou `https://`. Na exibicao, o Ginga confirma o dominio antes de abrir o link externo.

## Compatibilidade

Usuarios antigos continuam usando valores padrao (tema Classico, sem moldura e sem efeito) ate salvarem uma personalizacao.
