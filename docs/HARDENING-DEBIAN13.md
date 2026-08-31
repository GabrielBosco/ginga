# Hardening básico do host Debian 13

Este documento é um checklist operacional, não substitui a política de segurança da organização.

- mantenha Debian, Docker e kernel atualizados;
- use SSH com chaves e restrinja acesso administrativo;
- limite firewall às portas realmente necessárias;
- não publique PostgreSQL (`5432`) ou Redis (`6379`);
- use HTTPS/WSS em instalações acessíveis pela Internet;
- mantenha `.env` em modo `600`;
- mantenha `secrets/update-signing/private.pem` fora do repositório e com acesso mínimo;
- faça backup do banco, uploads e configurações;
- teste restauração dos backups;
- monitore espaço em disco, uso de CPU/RAM e logs;
- revise regras de NAT/port-forwarding do LiveKit;
- rode periodicamente:

```bash
./scripts/audit-production.sh
```

Evite `docker compose down -v` em produção: a opção `-v` remove volumes persistentes.
