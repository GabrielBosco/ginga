# Política de segurança

## Versões com suporte

Durante a fase `0.x`, somente a linha mais recente recebe correções de segurança.

| Versão | Recebe correções |
| --- | --- |
| 0.2.x | Sim |
| < 0.2 | Não |

## Como relatar uma vulnerabilidade

Não abra uma Issue pública para uma falha que possa ser explorada.

Quando disponível, use o **Relato privado de vulnerabilidade do GitHub** no repositório. Inclua:

- versão afetada;
- componente afetado (`web`, `api`, `desktop`, Android, implantação ou SDK);
- impacto observado;
- passos mínimos para reproduzir;
- logs sem tokens, senhas ou dados pessoais;
- sugestão de correção, se houver.

Durante os testes, não acesse dados de terceiros, não mantenha acesso persistente, não interrompa serviços e não execute ações destrutivas.

## Segredos

Nunca publique em Issue, Discussion, commit ou Pull Request:

- `.env` real;
- segredo JWT;
- senha de PostgreSQL, Redis ou SMTP;
- segredo da API do LiveKit;
- chave privada do atualizador;
- tokens de bots ou webhooks;
- backups de produção;
- certificados ou chaves privadas TLS.

Antes de publicar uma cópia do projeto, execute:

```bash
./scripts/prepare-github.sh
```

## Boas práticas para quem hospeda

- use HTTPS/WSS em instalações públicas;
- mantenha Docker e Debian atualizados;
- não publique PostgreSQL ou Redis na Internet;
- use senhas e segredos gerados aleatoriamente;
- habilite 2FA na conta administrativa;
- mantenha backups testados e fora do servidor principal;
- revise logs e atualizações de segurança regularmente.

Consulte também [docs/HARDENING-DEBIAN13.md](docs/HARDENING-DEBIAN13.md).
