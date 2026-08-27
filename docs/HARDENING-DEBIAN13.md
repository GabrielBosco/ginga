# Reforço de segurança recomendado — Debian 13

Este documento apresenta uma base de segurança para uma instalação Ginga exposta à Internet. Adapte as regras às políticas da sua infraestrutura antes de alterar firewall ou SSH.

## Script opcional

O repositório inclui um script de reforço para Debian 13:

```bash
sudo ./scripts/hardening-debian13.sh
```

Na execução padrão, ele **não fecha o firewall** e **não desativa login por senha ou root**. As etapas que podem interromper acesso são opcionais. Leia a ajuda antes de usá-las:

```bash
./scripts/hardening-debian13.sh --help
```

## Sistema

- prefira Debian 13 minimal;
- mantenha `unattended-upgrades` ativo;
- mantenha relógio e NTP sincronizados, especialmente por causa do TOTP;
- evite instalar serviços que não serão utilizados;
- não execute a aplicação diretamente como root fora dos containers;
- mantenha Docker e pacotes de segurança atualizados.

Pacotes úteis:

```bash
sudo apt update
sudo apt install -y unattended-upgrades fail2ban auditd apparmor apparmor-utils nftables
```

## SSH

Prefira autenticação por chave Ed25519 e um usuário administrativo com `sudo`.

Antes de desativar senha ou acesso root, confirme o login por chave em uma segunda sessão. Uma política comum depois dessa validação é:

```text
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 4
LoginGraceTime 30
X11Forwarding no
```

Sempre execute `sshd -t` antes de recarregar o serviço.

## Firewall

Em uma instalação padrão de produção, a superfície pública esperada é:

```text
80/TCP
443/TCP
443/UDP
7881/TCP
7882/UDP
3478/UDP  # somente se TURN estiver habilitado
SSH/TCP   # porta definida pelo administrador
```

Não publique:

```text
5432/TCP  PostgreSQL
6379/TCP  Redis
3001/TCP  API interna
7880/TCP  sinalização LiveKit interna na configuração de produção
```

Ao usar Docker, lembre que portas publicadas pelos containers também precisam ser consideradas na política de filtragem do Docker/`DOCKER-USER`.

## Segredos

```bash
chmod 600 .env
chmod 700 secrets 2>/dev/null || true
```

A chave privada do atualizador deve existir somente em máquinas autorizadas de compilação/publicação e precisa de backup seguro fora do servidor principal.

## Docker

Recomendações básicas:

- `no-new-privileges` nos containers;
- banco e cache somente na rede interna Docker;
- imagens com versões definidas;
- rotação de logs;
- backups testados;
- revisão periódica de `docker compose ps` e `docker ps --format 'table {{.Names}}\t{{.Ports}}'`.

## Auditoria do Ginga

Depois de subir a produção:

```bash
./scripts/audit-production.sh
```

Revise qualquer `FAIL` antes de considerar a instalação pronta para uso público.
