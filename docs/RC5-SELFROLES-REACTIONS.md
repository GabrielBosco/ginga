# Ginga 0.4.3 RC5 — Self Roles & Reactions

## Cargos próprios

- Usuários que possuem a capacidade `manageRoles` podem alterar seus próprios cargos personalizados.
- A validação de hierarquia e de permissões continua ativa por cargo.
- A remoção do bloqueio não libera um membro comum para administrar cargos sem a permissão correspondente.

## Reações

- Novo chip compacto e consistente com o restante da UI.
- Estado visual próprio para reação do usuário atual.
- Hover/foco exibe um card profissional com os nomes de quem reagiu.
- Para reações numerosas, mostra os primeiros nomes e a quantidade restante.
- Payload de reação passa a carregar `username` de forma consistente também via Socket.IO.
