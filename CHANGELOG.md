# Histórico de versões

As mudanças relevantes do Ginga são registradas neste arquivo.

O projeto segue versionamento semântico enquanto avança para a versão `1.0.0`.

## [0.2.0] - 2026-08-27

### Adicionado

- presença de jogos no cliente Desktop;
- sobreposição Desktop com jogo, canal de voz e participantes;
- Push-to-Talk configurável por tecla ou botão do mouse;
- autenticação em duas etapas TOTP com códigos de recuperação;
- fluxo seguro de redefinição de senha por e-mail;
- validação de senhas expostas usando Pwned Passwords por k-anonymity;
- melhorias no Portal de Administração, Portal do Desenvolvedor e Base de Conhecimento;
- pipeline assinado de atualização do Windows;
- auditoria de produção e verificação antes de publicação como código aberto;
- base Android experimental;
- melhorias de responsividade para celulares.

### Corrigido

- troca de presença Online/Ausente/Ocupado/Invisível;
- inconsistências de payload e tratamento de erros internos;
- layout da Base de Conhecimento e modais;
- detecção de processos de jogos no Desktop;
- nova tentativa automática ao consultar o manifesto de atualização;
- proteção contra reutilização simultânea de código de recuperação;
- resolução de e-mail com MX e alternativa A/AAAA;
- referências legadas de servidor no Desktop.

### Segurança

- segredos locais mantidos fora do repositório;
- PostgreSQL e Redis sem publicação direta na configuração de produção;
- containers com `no-new-privileges` e API em modo somente leitura onde aplicável;
- limites de requisição, validação de upload e sessões revogáveis;
- endpoint de informações internas restrito à administração global.
