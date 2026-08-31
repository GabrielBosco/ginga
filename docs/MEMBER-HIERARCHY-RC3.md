# Ginga 0.4.3 RC3 — Hierarquia visual de cargos

## Lista de membros

- cargos com **Exibir membros separadamente** criam grupos na lateral;
- se um membro possui varios cargos separados, somente o cargo de maior `position` define o grupo;
- a ordem dos grupos acompanha a hierarquia configurada em Cargos;
- nao existe grupo artificial `Dono`/`Proprietario`;
- o criador do servidor recebe uma **coroa** ao lado do nome;
- cada grupo pode ser recolhido/expandido;
- dentro do grupo, online vem antes de offline e depois a lista fica alfabetica.

## Identidade do cargo

O cargo personalizado mais alto do membro define a cor do nome em:

- lista de membros;
- autor da mensagem no chat;
- busca/fixados/respostas do chat;
- card de perfil;
- perfil completo.

A sala de voz permanece com nomes neutros, conforme solicitado.

## Voz

- webcam usa icones `Video` / `VideoOff`;
- compartilhamento usa `ScreenShare`;
- transmissao ativa tem estado visual verde e indicador discreto.
