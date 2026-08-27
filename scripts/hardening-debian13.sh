#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 027

VERSION="1.0.0"

GINGA_DIR="/opt/ginga"
ADMIN_USER=""
SSH_PORT_OVERRIDE=""
APPLY_FIREWALL=0
LOCKDOWN_SSH=0
ENABLE_TURN=0
RUN_UPGRADE=0
RESTART_DOCKER=0

log()  { printf '\033[1;34m[GINGA]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ OK ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE_EOF'
Ginga Debian 13 Hardening

Uso:
  ./ginga-hardening-debian13.sh [opcoes]

Baseline seguro (padrao):
  - Atualizacoes automaticas de seguranca
  - Fail2ban no SSH
  - Sysctl/kernel/network hardening
  - AppArmor + auditd
  - SSH baseline sem bloquear senha/root
  - Rotacao de logs do Docker
  - Permissoes dos segredos do Ginga
  - Auditoria final

Opcoes:
  --firewall
      Ativa firewall estrito do HOST e protecao DOCKER-USER.
      Libera: SSH detectado, 80/TCP, 443/TCP, 443/UDP,
              7881/TCP, 7882/UDP e opcionalmente 3478/UDP.

  --turn
      Ao usar --firewall, libera 3478/UDP para TURN.

  --lockdown-ssh --admin-user USUARIO
      Somente depois que o usuario possuir chave SSH funcional:
      desativa login root e autenticacao por senha.

  --ssh-port PORTA
      Sobrescreve a porta SSH detectada automaticamente.

  --upgrade
      Executa apt-get upgrade -y alem de instalar os pacotes.

  --restart-docker
      Reinicia Docker apos atualizar daemon.json.
      Sem esta opcao o arquivo e preparado, mas Docker nao e reiniciado.

  --ginga-dir CAMINHO
      Padrao: /opt/ginga

  -h, --help
      Mostra esta ajuda.

Exemplo seguro inicial:
  ./ginga-hardening-debian13.sh

Depois, quando quiser fechar o firewall:
  ./ginga-hardening-debian13.sh --firewall --turn

Depois que validar login SSH por chave de um usuario sudo:
  ./ginga-hardening-debian13.sh --lockdown-ssh --admin-user gingaadmin
USAGE_EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --firewall)
      APPLY_FIREWALL=1
      shift
      ;;
    --turn)
      ENABLE_TURN=1
      shift
      ;;
    --lockdown-ssh)
      LOCKDOWN_SSH=1
      shift
      ;;
    --admin-user)
      [[ $# -ge 2 ]] || die "--admin-user requer um usuario"
      ADMIN_USER="$2"
      shift 2
      ;;
    --ssh-port)
      [[ $# -ge 2 ]] || die "--ssh-port requer uma porta"
      SSH_PORT_OVERRIDE="$2"
      shift 2
      ;;
    --upgrade)
      RUN_UPGRADE=1
      shift
      ;;
    --restart-docker)
      RESTART_DOCKER=1
      shift
      ;;
    --ginga-dir)
      [[ $# -ge 2 ]] || die "--ginga-dir requer um caminho"
      GINGA_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Opcao desconhecida: $1"
      ;;
  esac
done

[[ $EUID -eq 0 ]] || die "Execute como root."

[[ -r /etc/os-release ]] || die "/etc/os-release nao encontrado."
source /etc/os-release
[[ "${ID:-}" == "debian" ]] || die "Este script foi feito para Debian."
[[ "${VERSION_ID:-}" == "13" ]] || warn "Debian ${VERSION_ID:-desconhecido} detectado. O alvo oficial e Debian 13."

command -v systemctl >/dev/null 2>&1 || die "systemd nao encontrado."

TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/root/ginga-hardening-backup-${TS}"
REPORT="/root/ginga-hardening-report-${TS}.txt"
ROLLBACK="/root/ginga-hardening-rollback-${TS}.sh"

mkdir -p "$BACKUP_DIR"

backup_path() {
  local p="$1"
  if [[ -e "$p" ]]; then
    mkdir -p "$BACKUP_DIR$(dirname "$p")"
    cp -a "$p" "$BACKUP_DIR$p"
  fi
}

log "Ginga Debian 13 Hardening v${VERSION}"
log "Backup: ${BACKUP_DIR}"

backup_path /etc/ssh/sshd_config
backup_path /etc/ssh/sshd_config.d
backup_path /etc/sysctl.d
backup_path /etc/fail2ban
backup_path /etc/docker/daemon.json
backup_path /etc/audit/rules.d
backup_path /etc/apt/apt.conf.d/20auto-upgrades
backup_path /etc/apt/apt.conf.d/52unattended-upgrades-local

detect_ssh_port() {
  if [[ -n "$SSH_PORT_OVERRIDE" ]]; then
    printf '%s\n' "$SSH_PORT_OVERRIDE"
    return
  fi

  if command -v sshd >/dev/null 2>&1; then
    local p
    p="$(sshd -T 2>/dev/null | awk '$1=="port"{print $2; exit}' || true)"
    if [[ "$p" =~ ^[0-9]+$ ]]; then
      printf '%s\n' "$p"
      return
    fi
  fi

  printf '22\n'
}

SSH_PORT="$(detect_ssh_port)"
[[ "$SSH_PORT" =~ ^[0-9]+$ ]] || die "Porta SSH invalida: $SSH_PORT"
(( SSH_PORT >= 1 && SSH_PORT <= 65535 )) || die "Porta SSH fora do intervalo: $SSH_PORT"

EXT_IF="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}' || true)"
[[ -n "$EXT_IF" ]] || EXT_IF="$(ip route show default 2>/dev/null | awk '{print $5; exit}' || true)"

log "SSH detectado na porta: ${SSH_PORT}"
[[ -n "$EXT_IF" ]] && log "Interface externa detectada: ${EXT_IF}" || warn "Nao foi possivel detectar interface externa."

export DEBIAN_FRONTEND=noninteractive

log "Atualizando indice APT..."
apt-get update -y

if (( RUN_UPGRADE == 1 )); then
  log "Aplicando atualizacoes instaladas..."
  apt-get upgrade -y
fi

log "Instalando ferramentas de seguranca..."
apt-get install -y \
  ca-certificates \
  curl \
  openssl \
  unattended-upgrades \
  apt-listchanges \
  needrestart \
  fail2ban \
  auditd \
  apparmor \
  apparmor-utils \
  lynis \
  debsums \
  nftables \
  iptables \
  jq

ok "Pacotes de seguranca instalados."

log "Configurando unattended-upgrades..."
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'AUTO_EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
AUTO_EOF

cat > /etc/apt/apt.conf.d/52unattended-upgrades-local <<'UNATTENDED_EOF'
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Remove-New-Unused-Dependencies "true";
UNATTENDED_EOF

systemctl enable --now unattended-upgrades.service >/dev/null 2>&1 || true
ok "Atualizacoes automaticas de seguranca habilitadas."

log "Configurando Fail2ban para SSH..."
mkdir -p /etc/fail2ban/jail.d
cat > /etc/fail2ban/jail.d/ginga-sshd.local <<EOF_FAIL2BAN
[sshd]
enabled = true
backend = systemd
port = ${SSH_PORT}
maxretry = 5
findtime = 10m
bantime = 1h
bantime.increment = true
bantime.factor = 2
bantime.maxtime = 1w
EOF_FAIL2BAN

systemctl enable --now fail2ban.service >/dev/null 2>&1 || true
systemctl restart fail2ban.service
fail2ban-client status sshd >/dev/null
ok "Fail2ban ativo no SSH."

log "Aplicando hardening de kernel/rede..."
cat > /etc/sysctl.d/99-ginga-hardening.conf <<'SYSCTL_EOF'
# Ginga production hardening

# Kernel / memory
kernel.randomize_va_space = 2
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.yama.ptrace_scope = 1
fs.suid_dumpable = 0

# Filesystem protections
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
fs.protected_fifos = 2
fs.protected_regular = 2

# TCP/IP
net.ipv4.tcp_syncookies = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1

# Reject ICMP redirects and source routing
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.secure_redirects = 0
net.ipv4.conf.default.secure_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0

# Log suspicious packets
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1

# IPv6 equivalents. IPv6 itself is intentionally NOT disabled.
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv6.conf.default.accept_source_route = 0
SYSCTL_EOF

sysctl --system >/dev/null
ok "Sysctl aplicado."

log "Aplicando baseline do OpenSSH..."
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/99-ginga-hardening.conf <<'SSH_EOF'
PermitEmptyPasswords no
MaxAuthTries 4
LoginGraceTime 30
X11Forwarding no
PermitTunnel no
GatewayPorts no
ClientAliveInterval 300
ClientAliveCountMax 2
SSH_EOF

if (( LOCKDOWN_SSH == 1 )); then
  [[ -n "$ADMIN_USER" ]] || die "--lockdown-ssh exige --admin-user USUARIO"
  id "$ADMIN_USER" >/dev/null 2>&1 || die "Usuario ${ADMIN_USER} nao existe."

  ADMIN_HOME="$(getent passwd "$ADMIN_USER" | cut -d: -f6)"
  [[ -n "$ADMIN_HOME" ]] || die "Nao foi possivel descobrir HOME de ${ADMIN_USER}."
  [[ -s "${ADMIN_HOME}/.ssh/authorized_keys" ]] || die "${ADMIN_USER} nao possui authorized_keys. Nao vou bloquear senha/root."

  if ! id -nG "$ADMIN_USER" | tr ' ' '\n' | grep -qx sudo; then
    warn "${ADMIN_USER} nao esta no grupo sudo. Adicionando."
    usermod -aG sudo "$ADMIN_USER"
  fi

  cat >> /etc/ssh/sshd_config.d/99-ginga-hardening.conf <<'SSH_STRICT_EOF'

# Strict mode
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
SSH_STRICT_EOF
fi

if ! sshd -t; then
  rm -f /etc/ssh/sshd_config.d/99-ginga-hardening.conf
  die "sshd_config invalido. Arquivo de hardening removido."
fi

systemctl reload ssh.service 2>/dev/null || systemctl reload sshd.service 2>/dev/null || true

if (( LOCKDOWN_SSH == 1 )); then
  warn "SSH STRICT MODE ativo. NAO feche sua sessao atual antes de testar outro login com ${ADMIN_USER}."
else
  ok "SSH baseline aplicado. Login por senha/root NAO foi desabilitado."
fi

log "Habilitando AppArmor e auditd..."
systemctl enable --now apparmor.service >/dev/null 2>&1 || true
systemctl enable --now auditd.service >/dev/null 2>&1 || true

AUDIT_FILE="/etc/audit/rules.d/ginga-hardening.rules"
: > "$AUDIT_FILE"

add_audit_watch() {
  local p="$1"
  local key="$2"
  if [[ -e "$p" ]]; then
    printf -- '-w %s -p wa -k %s\n' "$p" "$key" >> "$AUDIT_FILE"
  fi
}

add_audit_watch /etc/ssh/sshd_config ssh_config
add_audit_watch /etc/ssh/sshd_config.d ssh_config
add_audit_watch /etc/docker/daemon.json docker_config
add_audit_watch "${GINGA_DIR}/.env" ginga_secrets

augenrules --load >/dev/null 2>&1 || warn "Nao foi possivel recarregar todas as regras do auditd."
ok "Auditoria de configuracoes sensiveis preparada."

if command -v docker >/dev/null 2>&1; then
  log "Configurando rotacao de logs do Docker..."
  mkdir -p /etc/docker

  if [[ -s /etc/docker/daemon.json ]]; then
    if jq empty /etc/docker/daemon.json >/dev/null 2>&1; then
      tmp_json="$(mktemp)"
      jq '
        .["live-restore"] = true
        | .["log-driver"] = "json-file"
        | .["log-opts"] = ((.["log-opts"] // {}) + {
            "max-size": "25m",
            "max-file": "5"
          })
      ' /etc/docker/daemon.json > "$tmp_json"
      install -m 0644 "$tmp_json" /etc/docker/daemon.json
      rm -f "$tmp_json"
    else
      warn "/etc/docker/daemon.json existe mas nao e JSON valido. Nao foi alterado."
    fi
  else
    cat > /etc/docker/daemon.json <<'DOCKER_EOF'
{
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "25m",
    "max-file": "5"
  }
}
DOCKER_EOF
  fi

  if command -v dockerd >/dev/null 2>&1; then
    dockerd --validate --config-file=/etc/docker/daemon.json >/dev/null \
      || die "daemon.json do Docker falhou na validacao."
  fi

  if (( RESTART_DOCKER == 1 )); then
    warn "Reiniciando Docker conforme solicitado..."
    systemctl restart docker.service
    ok "Docker reiniciado."
  else
    warn "daemon.json atualizado. Use --restart-docker numa janela de manutencao para aplicar ao daemon atual."
  fi
fi

log "Protegendo arquivos sensiveis do Ginga..."
if [[ -f "${GINGA_DIR}/.env" ]]; then
  chown root:root "${GINGA_DIR}/.env"
  chmod 600 "${GINGA_DIR}/.env"
  ok "${GINGA_DIR}/.env = root:root 0600"
fi

if [[ -d /root/.secrets ]]; then
  chmod 700 /root/.secrets
  find /root/.secrets -type f -exec chmod 600 {} +
fi

if [[ -f /opt/ginga-build/secrets/update-signing/private.pem ]]; then
  chown root:root /opt/ginga-build/secrets/update-signing/private.pem
  chmod 600 /opt/ginga-build/secrets/update-signing/private.pem
  ok "Chave privada do updater protegida."
fi


create_host_firewall_script() {
  cat > /usr/local/sbin/ginga-host-firewall.sh <<EOF_HOST_FW
#!/usr/bin/env bash
set -Eeuo pipefail

nft delete table inet ginga_filter 2>/dev/null || true

nft -f - <<'NFT_EOF'
table inet ginga_filter {
  chain input {
    type filter hook input priority -10; policy drop;

    iifname "lo" accept

    ct state invalid drop
    ct state established,related accept

    ip protocol icmp accept
    ip6 nexthdr ipv6-icmp accept

    udp sport 67 udp dport 68 accept
    udp sport 547 udp dport 546 accept

    tcp dport ${SSH_PORT} accept

    tcp dport 80 accept
    tcp dport 443 accept
    udp dport 443 accept

    tcp dport 7881 accept
    udp dport 7882 accept
$(if (( ENABLE_TURN == 1 )); then printf '    udp dport 3478 accept\n'; fi)
  }
}
NFT_EOF
EOF_HOST_FW

  chmod 750 /usr/local/sbin/ginga-host-firewall.sh

  cat > /etc/systemd/system/ginga-host-firewall.service <<'HOST_UNIT_EOF'
[Unit]
Description=Ginga host input firewall
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/ginga-host-firewall.sh
ExecStop=/usr/sbin/nft delete table inet ginga_filter
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
HOST_UNIT_EOF
}

create_docker_guard_script() {
  [[ -n "$EXT_IF" ]] || {
    warn "Sem interface externa detectada; DOCKER-USER guard nao sera criado."
    return
  }

  cat > /usr/local/sbin/ginga-docker-guard.sh <<EOF_DOCKER_GUARD
#!/usr/bin/env bash
set -Eeuo pipefail

EXT_IF="${EXT_IF}"

if ! iptables -nL DOCKER-USER >/dev/null 2>&1; then
  exit 0
fi

iptables -N GINGA-DOCKER-GUARD 2>/dev/null || true
iptables -F GINGA-DOCKER-GUARD

iptables -C DOCKER-USER -j GINGA-DOCKER-GUARD >/dev/null 2>&1 \
  || iptables -I DOCKER-USER 1 -j GINGA-DOCKER-GUARD

iptables -A GINGA-DOCKER-GUARD -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -A GINGA-DOCKER-GUARD -i "\$EXT_IF" -p tcp --dport 80 -j RETURN
iptables -A GINGA-DOCKER-GUARD -i "\$EXT_IF" -p tcp --dport 443 -j RETURN
iptables -A GINGA-DOCKER-GUARD -i "\$EXT_IF" -p udp --dport 443 -j RETURN
iptables -A GINGA-DOCKER-GUARD -i "\$EXT_IF" -p tcp --dport 7881 -j RETURN
iptables -A GINGA-DOCKER-GUARD -i "\$EXT_IF" -p udp --dport 7882 -j RETURN
$(if (( ENABLE_TURN == 1 )); then printf 'iptables -A GINGA-DOCKER-GUARD -i "$EXT_IF" -p udp --dport 3478 -j RETURN\n'; fi)
iptables -A GINGA-DOCKER-GUARD -i "\$EXT_IF" -m conntrack --ctstate NEW -j DROP
iptables -A GINGA-DOCKER-GUARD -j RETURN
EOF_DOCKER_GUARD

  chmod 750 /usr/local/sbin/ginga-docker-guard.sh

  cat > /etc/systemd/system/ginga-docker-guard.service <<'DOCKER_UNIT_EOF'
[Unit]
Description=Ginga Docker published-port guard
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/ginga-docker-guard.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
DOCKER_UNIT_EOF
}

if (( APPLY_FIREWALL == 1 )); then
  warn "Ativando firewall estrito. SSH liberado na porta ${SSH_PORT}."
  create_host_firewall_script

  systemctl daemon-reload
  systemctl enable ginga-host-firewall.service >/dev/null
  systemctl restart ginga-host-firewall.service

  if command -v docker >/dev/null 2>&1; then
    create_docker_guard_script
    if [[ -f /etc/systemd/system/ginga-docker-guard.service ]]; then
      systemctl daemon-reload
      systemctl enable ginga-docker-guard.service >/dev/null
      systemctl restart ginga-docker-guard.service || warn "DOCKER-USER guard nao pode ser aplicado agora."
    fi
  fi

  ok "Firewall estrito aplicado."
else
  warn "Firewall estrito NAO aplicado. Rode novamente com --firewall quando quiser fechar a superficie de rede."
fi

log "Criando rollback..."
cat > "$ROLLBACK" <<EOF_ROLLBACK
#!/usr/bin/env bash
set -Eeuo pipefail

echo "Desativando regras de firewall do hardening..."
systemctl disable --now ginga-host-firewall.service 2>/dev/null || true
systemctl disable --now ginga-docker-guard.service 2>/dev/null || true
nft delete table inet ginga_filter 2>/dev/null || true

if iptables -nL DOCKER-USER >/dev/null 2>&1; then
  iptables -D DOCKER-USER -j GINGA-DOCKER-GUARD 2>/dev/null || true
  iptables -F GINGA-DOCKER-GUARD 2>/dev/null || true
  iptables -X GINGA-DOCKER-GUARD 2>/dev/null || true
fi

rm -f /etc/ssh/sshd_config.d/99-ginga-hardening.conf
rm -f /etc/sysctl.d/99-ginga-hardening.conf
rm -f /etc/fail2ban/jail.d/ginga-sshd.local
rm -f /etc/audit/rules.d/ginga-hardening.rules

sysctl --system >/dev/null 2>&1 || true
sshd -t && (systemctl reload ssh.service 2>/dev/null || true)
systemctl restart fail2ban.service 2>/dev/null || true

echo
echo "Rollback do hardening adicional concluido."
echo "Backup original disponivel em:"
echo "${BACKUP_DIR}"
EOF_ROLLBACK
chmod 700 "$ROLLBACK"

log "Gerando relatorio..."
{
  echo "Ginga Debian 13 Hardening Report"
  echo "Data: $(date -Is)"
  echo "Host: $(hostname -f 2>/dev/null || hostname)"
  echo "Debian: ${PRETTY_NAME:-unknown}"
  echo "SSH port: ${SSH_PORT}"
  echo "External interface: ${EXT_IF:-unknown}"
  echo "Firewall strict: ${APPLY_FIREWALL}"
  echo "SSH lockdown: ${LOCKDOWN_SSH}"
  echo "TURN allowed: ${ENABLE_TURN}"
  echo
  echo "=== Open sockets ==="
  ss -lntup || true
  echo
  echo "=== Fail2ban ==="
  fail2ban-client status sshd 2>&1 || true
  echo
  echo "=== AppArmor ==="
  aa-status 2>&1 | head -n 30 || true
  echo
  echo "=== Docker published ports ==="
  if command -v docker >/dev/null 2>&1; then
    docker ps --format 'table {{.Names}}\t{{.Ports}}' 2>&1 || true
  fi
  echo
  echo "=== Docker security options ==="
  if command -v docker >/dev/null 2>&1; then
    docker info 2>/dev/null | sed -n '/Security Options/,+8p' || true
  fi
  echo
  echo "=== Ginga sensitive file permissions ==="
  stat -c '%A %U:%G %n' "${GINGA_DIR}/.env" 2>/dev/null || true
  stat -c '%A %U:%G %n' /opt/ginga-build/secrets/update-signing/private.pem 2>/dev/null || true
  echo
  echo "=== Pending package upgrades ==="
  apt list --upgradable 2>/dev/null || true
  echo
  echo "=== Lynis quick suggestions ==="
  lynis audit system --quick --no-colors 2>/dev/null | tail -n 80 || true
} > "$REPORT"

ok "Hardening concluido."
echo
echo "Relatorio: ${REPORT}"
echo "Backup:    ${BACKUP_DIR}"
echo "Rollback:  ${ROLLBACK}"
echo
if (( APPLY_FIREWALL == 0 )); then
  echo "Proximo passo recomendado:"
  echo "  $0 --firewall$( (( ENABLE_TURN == 1 )) && printf ' --turn' )"
fi
if (( LOCKDOWN_SSH == 0 )); then
  echo
  echo "Depois de criar/testar um usuario sudo com chave SSH:"
  echo "  $0 --lockdown-ssh --admin-user SEU_USUARIO"
fi
