#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from datetime import date
import csv
import re
import shutil
import tempfile
import textwrap

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    Image, KeepTogether, Preformatted, HRFlowable
)

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PDF_PATH = HERE / 'relatorio-auditoria-seguranca.pdf'
ROUTE_CSV = HERE / 'cobertura-rotas.csv'

PROJECT = 'Ginga'
VERSION = '0.4.7 OVERLAY-FINAL-R1'
AUDIT_DATE = date(2026, 9, 1)

PALETTE = {
    'Crítica': '#B91C1C',
    'Alta': '#EA580C',
    'Média': '#D97706',
    'Baixa': '#2563EB',
    'Ponto forte': '#059669',
    'Ink': '#172033',
    'Muted': '#667085',
    'Line': '#D9DEE8',
    'Panel': '#F6F8FB',
    'Brand': '#6D5DFB',
}

FINDINGS = [
    {
        'id': 'F1',
        'severity': 'Alta',
        'category': 'Banco sem tranca / isolamento de tenant',
        'title': 'Onboarding aceita cargo de outro servidor e o aplica como permissão local',
        'summary': (
            'A criação de opções do onboarding aceita roleId e channelIds arbitrários. Na conclusão do onboarding, '
            'o roleId é gravado em GuildMemberCustomRole com o guildId da vítima sem confirmar que o cargo pertence '
            'ao mesmo servidor. O cálculo de permissões confia nessa associação e agrega as permissões do cargo estrangeiro.'
        ),
        'exploit': (
            'Explorável por um usuário com manageServer em um servidor A que conheça o ID de um cargo customizado de '
            'outro servidor B. Ao configurar uma opção do onboarding com esse ID e fazer um membro concluir o fluxo, '
            'as permissões do cargo de B passam a ser consideradas no servidor A. O atacante não precisa ser dono de B, '
            'apenas conhecer um roleId válido; a condição prática mais simples é participar de ambos os servidores.'
        ),
        'impact': 'Escalada de privilégio entre tenants/servidores e quebra do isolamento de autorização.',
        'fix': (
            'Validar roleId e cada channelId contra o guildId da pergunta antes de persistir; revalidar na aplicação do '
            'onboarding; em effectiveGuildPermissionsForUser, carregar somente cargos cujo role.guildId seja igual ao '
            'guildId da associação; adicionar invariante/constraint de aplicação para impedir associações cruzadas.'
        ),
        'acceptance': [
            'POST de opção rejeita roleId de outro guild com 400/404.',
            'POST de opção rejeita channelIds de outro guild.',
            'Conclusão do onboarding revalida os IDs persistidos antes de conceder cargos.',
            'effectiveGuildPermissionsForUser ignora/rejeita qualquer associação cujo role.guildId divergir.',
            'Teste automatizado cross-tenant prova que um cargo estrangeiro não concede capacidade no guild atual.'
        ],
        'evidence': [
            ('apps/api/src/routes/v090.ts', 76, 76, 'Entrada aceita roleId/channelIds sem validar o guild de cada referência.'),
            ('apps/api/src/routes/v090.ts', 81, 81, 'Conclusão grava roleId arbitrário em guildMemberCustomRole usando guildId do fluxo.'),
            ('apps/api/src/v090Storage.ts', 27, 29, 'FK do onboarding aponta para role por ID e channel_ids é TEXT[], sem vínculo de tenant.'),
            ('apps/api/prisma/schema.prisma', 297, 306, 'GuildMemberCustomRole referencia Guild e GuildCustomRole de forma independente.'),
            ('apps/api/src/permissions.ts', 250, 258, 'Cálculo agrega role.permissions das associações sem conferir role.guildId.')
        ],
    },
    {
        'id': 'F2',
        'severity': 'Média',
        'category': 'IDOR',
        'title': 'Atribuição de badge permite escrever em badge de outro servidor',
        'summary': (
            'A rota de atribuição exige manageRoles no guildId do path, mas insere badgeId e userId diretamente. '
            'Ela não confirma que a badge pertence ao guild do path nem que o usuário alvo é membro dele.'
        ),
        'exploit': (
            'Um moderador com manageRoles em A e conhecimento do ID de uma badge de B pode chamar a rota de A com '
            'badgeId de B e associá-la a qualquer User existente. A remoção da mesma associação contém a checagem que '
            'está ausente no PUT, confirmando a inconsistência.'
        ),
        'impact': 'Alteração não autorizada de dados pertencentes a outro tenant; integridade de badges e perfis afetada.',
        'fix': (
            'Buscar badge por {id: badgeId, guildId} antes do INSERT, exigir requireGuildMember(userId, guildId) para o '
            'alvo e manter a operação limitada à badge validada. Adicionar teste BOLA com IDs de guilds distintos.'
        ),
        'acceptance': [
            'PUT retorna 404/403 para badge de outro guild.',
            'PUT rejeita userId que não seja membro do guild alvo.',
            'Atribuição válida no mesmo guild continua funcionando.',
            'Teste automatizado cobre badgeId estrangeiro e userId não membro.'
        ],
        'evidence': [
            ('apps/api/src/routes/v090.ts', 96, 98, 'PUT insere IDs sem vínculo; DELETE logo abaixo valida badge.id + guild_id.'),
            ('apps/api/src/v090Storage.ts', 34, 35, 'Assignment referencia badge_id/user_id, sem guild_id próprio ou constraint composta.')
        ],
    },
    {
        'id': 'F3',
        'severity': 'Média',
        'category': 'Banco sem tranca / isolamento de tenant',
        'title': 'Referências auxiliares v0.9 aceitam categorias/canais de outro tenant',
        'summary': (
            'Várias estruturas auxiliares validam a permissão no recurso pai, porém não validam o tenant dos IDs '
            'referenciados: conteúdo de Space, modLogChannelId e categoryId de template de voz dinâmica. As tabelas '
            'armazenam FKs simples por ID e não possuem vínculo composto com guild_id.'
        ),
        'exploit': (
            'Exige capacidade legítima de administração no guild A e conhecimento de IDs de guild B. Em Space, IDs '
            'estrangeiros podem ser anexados a A. Em voz dinâmica, uma categoria de B pode ser salva no template e '
            'utilizada na criação de um Channel com guildId=A/categoryId=B; como canais sincronizados herdam permissões '
            'da category relacionada, regras estruturais da categoria estrangeira podem influenciar o canal de A.'
        ),
        'impact': (
            'Quebra de invariantes de tenant, corrupção de relações e possibilidade de aplicar regras de categoria de '
            'outro servidor a um canal recém-criado. O modLogChannelId atualmente é sobretudo um problema de integridade '
            'de configuração, pois o uso de envio de log não foi encontrado no código auditado.'
        ),
        'fix': (
            'Criar helpers de validação tenant-scoped (assertCategoryInGuild/assertChannelInGuild) e usá-los em todos os '
            'IDs auxiliares antes de persistir. Para estruturas novas, preferir guardar guild_id e usar constraints/índices '
            'compostos quando o modelo permitir. Na criação dinâmica, revalidar category_id antes do prisma.channel.create.'
        ),
        'acceptance': [
            'Space rejeita categoria/canal de outro guild.',
            'security-policy rejeita modLogChannelId de outro guild.',
            'dynamic-voice template rejeita categoryId de outro guild.',
            'Criação dinâmica revalida a categoria persistida.',
            'Testes cross-tenant cobrem os três fluxos.'
        ],
        'evidence': [
            ('apps/api/src/routes/v090.ts', 54, 54, 'Space content insere categoryIds/channelIds após validar só o guild do Space.'),
            ('apps/api/src/v090Storage.ts', 18, 21, 'Join tables possuem FKs simples e não codificam guild_id.'),
            ('apps/api/src/routes/v090.ts', 86, 86, 'security-policy persiste modLogChannelId sem conferir o guild do canal.'),
            ('apps/api/src/v090Storage.ts', 30, 31, 'Policy/template referenciam Channel/Category apenas por ID.'),
            ('apps/api/src/routes/v090.ts', 90, 92, 'Template aceita categoryId e create usa esse valor para criar canal no guild do path.'),
            ('apps/api/prisma/schema.prisma', 359, 370, 'Channel permite guildId e categoryId como FKs independentes.'),
            ('apps/api/src/permissions.ts', 420, 440, 'Canal sincronizado usa permissões/custom overrides/user overrides da category relacionada.')
        ],
    },
    {
        'id': 'F4',
        'severity': 'Média',
        'category': 'Permissão definida no navegador',
        'title': 'Ação ENDED do Ginga Music confia no playbackOwner do frontend',
        'summary': (
            'O frontend só envia ENDED quando playbackOwnerRef.current é verdadeiro. No backend, porém, a ação ENDED '
            'ignora musicAccess e exige apenas que o chamador seja membro do servidor. Um cliente modificado pode chamar '
            'o endpoint diretamente e avançar a fila.'
        ),
        'exploit': (
            'Qualquer membro autenticado do guild consegue consultar o estado/track atual e enviar POST /music/control '
            'com action=ENDED e expectedTrackId correto. Isso funciona mesmo quando musicAllowMembers=false e o cliente '
            'não possui o lease oficial de playback.'
        ),
        'impact': 'Manipulação não autorizada da fila e negação de serviço da reprodução compartilhada.',
        'fix': (
            'Vincular ENDED ao lease de playback validado no servidor. Exigir clientId + lease/token não forjável e '
            'confirmar que o chamador possui o lease ativo para o guild/canal; alternativamente, mover avanço automático '
            'para um coordenador server-side. Não usar um booleano do frontend como fronteira de autorização.'
        ),
        'acceptance': [
            'ENDED sem lease ativo retorna 403/409.',
            'ENDED de outro clientId não avança a fila.',
            'Cliente detentor do lease continua conseguindo reportar fim da faixa.',
            'musicAllowMembers=false não é burlado por chamada HTTP manual.',
            'Teste de integração cobre chamada direta ao endpoint sem UI.'
        ],
        'evidence': [
            ('apps/web/src/components/GingaMusicPlayer.tsx', 306, 317, 'Gate de playbackOwner existe somente no cliente antes do POST.'),
            ('apps/api/src/routes/music.ts', 178, 184, 'musicAccess é o helper server-side que restringe controle quando membros não podem controlar.'),
            ('apps/api/src/routes/music.ts', 444, 453, 'Qualquer membro pode ler o estado e obter o track atual.'),
            ('apps/api/src/routes/music.ts', 596, 611, 'ENDED usa apenas requireGuildMember e avança a fila quando expectedTrackId confere.')
        ],
    },
    {
        'id': 'F5',
        'severity': 'Baixa',
        'category': 'Chaves expostas / defaults inseguros',
        'title': 'Defaults públicos de PostgreSQL/Redis podem virar credenciais reais se init.sh for ignorado',
        'summary': (
            '.env.example contém senhas públicas CHANGE_ME para PostgreSQL e Redis. O compose aceita esses valores e '
            'permite Redis sem autenticação quando REDIS_PASSWORD fica vazio. A validação de startup rejeita CHANGE_ME '
            'para JWT/LiveKit, mas não falha para credencial de banco/Redis.'
        ),
        'exploit': (
            'Condição necessária: operador copiar .env.example ou limpar REDIS_PASSWORD sem executar scripts/init.sh, '
            'ou expor essas redes/portas por configuração adicional. No compose padrão PostgreSQL/Redis não têm portas '
            'publicadas no host, reduzindo a exposição para rede interna/lateral. scripts/init.sh mitiga o cenário normal '
            'ao gerar segredos aleatórios, mas é uma convenção e não um controle fail-closed.'
        ),
        'impact': 'Credenciais previsíveis/ausência de senha em serviços internos se o bootstrap seguro for contornado.',
        'fix': (
            'Tornar POSTGRES_PASSWORD e REDIS_PASSWORD obrigatórios no compose com ${VAR:?required}; iniciar Redis sempre '
            'com --requirepass; adicionar preflight/startup que rejeite vazio/CHANGE_ME para credenciais de infraestrutura. '
            'Manter init.sh como conveniência, não como única barreira.'
        ),
        'acceptance': [
            'docker compose falha antes de subir se POSTGRES_PASSWORD estiver vazio/placeholder.',
            'docker compose falha se REDIS_PASSWORD estiver vazio/placeholder.',
            'Redis sempre inicia com autenticação no perfil de produção.',
            'Preflight documenta e testa placeholders proibidos.',
            'Instalação via init.sh continua gerando valores aleatórios.'
        ],
        'evidence': [
            ('.env.example', 7, 8, 'Placeholders públicos podem ser copiados como credenciais de runtime.'),
            ('docker-compose.yml', 10, 12, 'PostgreSQL recebe POSTGRES_PASSWORD diretamente do ambiente.'),
            ('docker-compose.yml', 22, 33, 'Redis aceita REDIS_PASSWORD vazio e inicia sem --requirepass nesse caso.'),
            ('docker-compose.yml', 89, 94, 'API constrói DATABASE_URL com POSTGRES_PASSWORD fornecido.'),
            ('apps/api/src/config.ts', 40, 49, 'Fail-closed cobre JWT/LiveKit, mas não PostgreSQL/Redis.'),
            ('scripts/init.sh', 34, 39, 'Mitigação existente: bootstrap gera senhas/segredos aleatórios.')
        ],
    },
]

STRENGTHS = [
    ('Autenticação revogável', 'apps/api/src/middleware.ts:8-30', 'Bearer JWT é validado e ainda é cruzado com tokenVersion, accountDisabled e sessão ativa.'),
    ('Isolamento base de guild', 'apps/api/src/permissions.ts:205-210', 'requireGuildMember usa chave composta guildId_userId e bloqueia acesso a quem não participa.'),
    ('Autorização de canal', 'apps/api/src/permissions.ts:383-457', 'requireChannelCapability centraliza membership, timeout, lockdown e overrides de role/usuário.'),
    ('Mensagens e busca', 'apps/api/src/routes/channels.ts:16-37; messages.ts:395-427', 'Leitura e busca de mensagens passam por visibilidade efetiva de canal antes da query final.'),
    ('Cargos customizados', 'apps/api/src/routes/roles.ts:187-236', 'Atribuição e overrides normais validam guild, hierarquia e vínculo channel/category-role.'),
    ('DM/amizades', 'apps/api/src/routes/social.ts:291-325', 'Aceite/remoção conferem a parte autenticada e listagem de DMs nasce das memberships do próprio usuário.'),
    ('Uploads', 'apps/api/src/routes/uploads.ts:73-149', 'Valida magic bytes, cota por uploader, delete por ownership e download por chave em comparação timing-safe + headers defensivos.'),
    ('LiveKit', 'apps/api/src/routes/livekit.ts:63-112', 'Token de voz requer connect no canal; token direto requer participação na chamada/conversa.'),
    ('XSS/HTML', 'apps/web/src/components/MessageContent.tsx:40-64; apps/web/src/lib/gamingProfile.ts:63-65,158-164', 'Links são limitados a http/https; mensagens usam React nodes; pontos de innerHTML encontrados aplicam escape explícito.'),
    ('CI/repository gate', '.github/workflows/ci.yml:25-62; scripts/prepare-github.sh:58-65', 'CI compila API/Web e executa gate de repositório; há scanner simples de segredos hardcoded.')
]

WEAK_POINTS = [
    'As extensões v0.9 criadas com SQL auxiliar não herdam automaticamente a disciplina de tenant do Prisma principal.',
    'Algumas relações possuem FKs independentes sem invariante guildId + foreignId, deixando a aplicação responsável por todas as checagens.',
    'O Ginga Music trata ENDED como sinal confiável do player, mas o servidor não autentica a posse do lease.',
    'Credenciais de infraestrutura ainda dependem do operador executar init.sh em vez de falhar de forma fechada.'
]

RECOMMENDATIONS = [
    ('P1', 'Fechar a escalada do onboarding', 'Bloquear roleId/channelIds cross-guild, revalidar na conclusão e filtrar role.guildId no cálculo de permissões.'),
    ('P2', 'Centralizar validação de referências tenant-scoped', 'Criar helpers assert*InGuild e aplicar em Space, badge, security policy, dynamic voice e novos módulos.'),
    ('P3', 'Proteger ENDED com lease server-side', 'Não confiar em playbackOwnerRef; validar o detentor do lease no endpoint de controle.'),
    ('P4', 'Fail-closed para PostgreSQL/Redis', 'Exigir secrets no compose/preflight e impedir Redis sem autenticação em produção.'),
    ('P5', 'Adicionar testes de autorização cross-tenant', 'Fixtures com dois guilds e IDs trocados para cada rota IDOR/associação; rodar no CI.'),
    ('P6', 'Adicionar secret scanning de histórico no CI', 'Executar gitleaks/trufflehog equivalente no clone completo; o ZIP auditado não contém .git e o histórico não pôde ser verificado nesta execução.')
]

METHOD_MAP = [
    ('1. Banco sem tranca', 'Sem Supabase/RLS. Mapeado para filtros/guards manuais por guildId/userId e integridade de referências entre Guild, Channel, Category, Role e tabelas v0.9.'),
    ('2. Permissão no navegador', 'Gates React (systemRole, permissions.*, playbackOwner) foram cruzados com os endpoints de escrita/controle correspondentes no Express.'),
    ('3. IDOR', 'Todas as 288 declarações de handlers HTTP do backend foram enumeradas; rotas por ID foram rastreadas até ownership/membership/guild/capability ou marcadas como achado.'),
    ('4. Chaves expostas', 'Busca no working tree, .env.example, Compose, Dockerfiles, CI, scripts, docs, PEMs e variáveis VITE. Histórico Git não disponível no ZIP e fetch público falhou.'),
    ('5. Inputs/XSS', 'Busca por innerHTML/dangerouslySetInnerHTML/eval/new Function, markdown/links, src/href controlados por usuário e HTML de e-mail; sinks encontrados foram rastreados até escaping/allowlist.')
]

ROUTE_FINDING_MAP = {
    ('POST', '/onboarding/questions/:questionId/options'): 'F1',
    ('PUT', '/guilds/:guildId/onboarding/me'): 'F1',
    ('PUT', '/guilds/:guildId/badges/:badgeId/members/:userId'): 'F2',
    ('PUT', '/spaces/:spaceId/content'): 'F3',
    ('PUT', '/guilds/:guildId/security-policy'): 'F3',
    ('POST', '/guilds/:guildId/dynamic-voice/templates'): 'F3',
    ('POST', '/guilds/:guildId/dynamic-voice/:templateId/create'): 'F3',
    ('POST', '/guilds/:guildId/music/control'): 'F4',
}

GUARDS = [
    'requireAuth','requireBotAuth','requirePlatformAdmin','requireDeveloperAccess','requireGuildMember',
    'requireGuildCapability','requireAnyGuildCapability','requireGuildManager','requireGuildOwner',
    'requireChannelCapability','requireChannelMember','requireDirectMember','requireModerationTarget',
    'requireModerationTargetAny','musicAccess','assertCanAssignRolesToTarget','assertCanManageUserOverride',
    'canJoinDirectCall','usersBlockEachOther','uploaderId','req.auth!.sub'
]

PUBLIC_HINTS = {
    ('POST','/register'): 'Público intencional - cadastro com validação/rate limit',
    ('POST','/login'): 'Público intencional - autenticação/rate limit',
    ('POST','/login/2fa'): 'Público intencional - desafio 2FA/rate limit',
    ('POST','/login/2fa-only'): 'Público intencional - recuperação 2FA/rate limit',
    ('POST','/session/restore'): 'Público intencional - cookie de sessão lembrada',
    ('POST','/password-reset/request'): 'Público intencional - recuperação/rate limit',
    ('POST','/password-reset/confirm'): 'Público intencional - token one-time',
    ('GET','/registration-policy'): 'Público intencional - política de cadastro',
    ('POST','/register/code'): 'Público intencional - desafio de e-mail',
    ('GET','/invites/:code'): 'Público intencional - preview de convite',
    ('POST','/api/webhooks/:webhookId'): 'Autenticação própria - Authorization Bearer do webhook',
    ('POST','/api/webhooks/:webhookId/:token'): 'Legado condicionado por flag - token na URL',
    ('GET','/uploads/:storedName'): 'Recurso tokenizado - accessKey timing-safe',
}


def read_lines(rel: str, start: int, end: int) -> str:
    p = ROOT / rel
    lines = p.read_text(encoding='utf-8', errors='replace').splitlines()
    out=[]
    for n in range(start, min(end, len(lines)) + 1):
        out.append(f'{n:>4} | {lines[n-1]}')
    return '\n'.join(out)


def route_rows():
    pattern = re.compile(r'\b(?P<router>[A-Za-z0-9_]*Router|app)\.(?P<method>get|post|put|patch|delete)\(\s*(?P<q>["`\'])(?P<path>/.*?)(?P=q)', re.S)
    rows=[]
    for p in sorted((ROOT/'apps/api/src').rglob('*.ts')):
        text=p.read_text(encoding='utf-8', errors='replace')
        matches=list(pattern.finditer(text))
        for i,m in enumerate(matches):
            line=text.count('\n',0,m.start())+1
            end=matches[i+1].start() if i+1<len(matches) else len(text)
            segment=text[m.start():end]
            method=m.group('method').upper(); path=m.group('path')
            found=[g for g in GUARDS if g in segment]
            finding=ROUTE_FINDING_MAP.get((method,path),'')
            if finding:
                status=f'ACHADO {finding}'
            elif (method,path) in PUBLIC_HINTS:
                status=PUBLIC_HINTS[(method,path)]
            elif 'requireAuth' in segment or 'requireBotAuth' in segment:
                status='Revisado - autenticado/autorizado ou autoescopado'
            else:
                # Media endpoints use etag/key, auth endpoints and public service endpoints are intentional.
                if any(x in path for x in ['/avatar/', '/banner/', '/emojis/', '/stickers/', '/soundboard/']) or ':etag' in path:
                    status='Público intencional - asset por ID + etag'
                else:
                    status='Público/guard custom - revisado manualmente'
            rows.append({
                'arquivo':str(p.relative_to(ROOT)), 'linha':line, 'metodo':method, 'rota':path,
                'protecoes_detectadas':'; '.join(found) if found else '-', 'status':status, 'achado':finding or '-'
            })
    return rows


def write_route_csv():
    rows=route_rows()
    with ROUTE_CSV.open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)
    return rows


def make_charts(tmp: Path):
    sev_counts = {'Crítica':0,'Alta':1,'Média':3,'Baixa':1}
    labels=[k for k,v in sev_counts.items() if v]
    values=[sev_counts[k] for k in labels]
    cols=[PALETTE[k] for k in labels]
    fig,ax=plt.subplots(figsize=(5.2,3.6),dpi=180)
    wedges,_=ax.pie(values, colors=cols, startangle=90, counterclock=False,
                    wedgeprops=dict(width=0.38, edgecolor='white'))
    ax.text(0,0.06,str(sum(values)),ha='center',va='center',fontsize=24,fontweight='bold',color=PALETTE['Ink'])
    ax.text(0,-0.18,'achados',ha='center',va='center',fontsize=10,color=PALETTE['Muted'])
    ax.legend(wedges,[f'{k}: {sev_counts[k]}' for k in labels],loc='center left',bbox_to_anchor=(0.92,0.5),frameon=False,fontsize=9)
    ax.set_title('Achados por severidade',fontsize=12,fontweight='bold',color=PALETTE['Ink'],pad=10)
    ax.set_aspect('equal'); fig.tight_layout()
    donut=tmp/'severidade.png'; fig.savefig(donut,bbox_inches='tight',facecolor='white'); plt.close(fig)

    cats=['Isolamento\ntenant','Permissão\nfrontend','IDOR','Chaves /\ndefaults','XSS']
    vals=[2,1,1,1,0]
    fig,ax=plt.subplots(figsize=(6.4,3.6),dpi=180)
    bars=ax.bar(cats,vals,color=[PALETTE['Alta'],PALETTE['Média'],PALETTE['Média'],PALETTE['Baixa'],PALETTE['Ponto forte']],width=0.64)
    ax.set_ylim(0,2.5); ax.set_yticks([0,1,2]); ax.grid(axis='y',alpha=.18)
    ax.spines[['top','right','left']].set_visible(False); ax.spines['bottom'].set_color('#D0D5DD')
    ax.tick_params(axis='x',labelsize=8); ax.tick_params(axis='y',labelsize=8,length=0)
    for b,v in zip(bars,vals): ax.text(b.get_x()+b.get_width()/2,v+0.06,str(v),ha='center',fontsize=9,fontweight='bold',color=PALETTE['Ink'])
    ax.set_title('Achados por categoria primária',fontsize=12,fontweight='bold',color=PALETTE['Ink'],pad=10)
    fig.tight_layout(); bar=tmp/'categorias.png'; fig.savefig(bar,bbox_inches='tight',facecolor='white'); plt.close(fig)
    return donut,bar


def register_fonts():
    normal='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    bold='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
    mono='/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
    monob='/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
    pdfmetrics.registerFont(TTFont('AuditSans',normal))
    pdfmetrics.registerFont(TTFont('AuditSans-Bold',bold))
    pdfmetrics.registerFont(TTFont('AuditMono',mono))
    pdfmetrics.registerFont(TTFont('AuditMono-Bold',monob))


def styles():
    s=getSampleStyleSheet()
    base=ParagraphStyle('base',fontName='AuditSans',fontSize=9.3,leading=14,textColor=HexColor(PALETTE['Ink']),spaceAfter=6)
    return {
        'body':base,
        'small':ParagraphStyle('small',parent=base,fontSize=8,leading=11,textColor=HexColor(PALETTE['Muted'])),
        'h1':ParagraphStyle('h1',parent=base,fontName='AuditSans-Bold',fontSize=20,leading=25,spaceBefore=8,spaceAfter=10,textColor=HexColor(PALETTE['Ink'])),
        'h2':ParagraphStyle('h2',parent=base,fontName='AuditSans-Bold',fontSize=14,leading=18,spaceBefore=10,spaceAfter=7,textColor=HexColor(PALETTE['Ink'])),
        'h3':ParagraphStyle('h3',parent=base,fontName='AuditSans-Bold',fontSize=10.5,leading=14,spaceBefore=6,spaceAfter=4,textColor=HexColor(PALETTE['Ink'])),
        'coverTitle':ParagraphStyle('coverTitle',parent=base,fontName='AuditSans-Bold',fontSize=29,leading=35,spaceAfter=12,textColor=HexColor(PALETTE['Ink'])),
        'coverSub':ParagraphStyle('coverSub',parent=base,fontSize=12,leading=18,textColor=HexColor(PALETTE['Muted']),spaceAfter=7),
        'table':ParagraphStyle('table',parent=base,fontSize=7.4,leading=10,spaceAfter=0),
        'tableBold':ParagraphStyle('tableBold',parent=base,fontName='AuditSans-Bold',fontSize=7.4,leading=10,spaceAfter=0),
        'code':ParagraphStyle('code',fontName='AuditMono',fontSize=6.7,leading=9,textColor=HexColor('#202939'),leftIndent=0,rightIndent=0,spaceBefore=2,spaceAfter=5),
        'issue':ParagraphStyle('issue',fontName='AuditMono',fontSize=7.0,leading=9.6,textColor=HexColor('#1F2937'),spaceAfter=8),
        'center':ParagraphStyle('center',parent=base,alignment=TA_CENTER),
    }


def P(text,style):
    # Text inserted here is report-authored and may intentionally use ReportLab's safe inline markup.
    return Paragraph(text,style)


def code_flow(text, st):
    # Preformatted handles raw symbols better; wrap long physical lines so the PDF remains legible.
    wrapped=[]
    for line in text.splitlines():
        if len(line) <= 112:
            wrapped.append(line)
        else:
            prefix=''
            rest=line
            while len(rest)>112:
                wrapped.append(rest[:112])
                rest='    '+rest[112:]
            wrapped.append(rest)
    return Preformatted('\n'.join(wrapped), st)


def severity_cell(sev, st):
    return P(f'<b>{sev.upper()}</b>', ParagraphStyle('chip'+sev,parent=st,fontName='AuditSans-Bold',fontSize=7.2,leading=9,textColor=colors.white,alignment=TA_CENTER))


def header_footer(canvas, doc):
    canvas.saveState()
    w,h=A4
    canvas.setStrokeColor(HexColor('#E3E7EE')); canvas.setLineWidth(0.5)
    canvas.line(20*mm,h-14*mm,w-20*mm,h-14*mm)
    canvas.setFont('AuditSans',7.2); canvas.setFillColor(HexColor(PALETTE['Muted']))
    canvas.drawString(20*mm,h-10.5*mm,f'Relatório de Auditoria de Segurança - {PROJECT}')
    canvas.drawRightString(w-20*mm,9*mm,f'Página {doc.page}')
    canvas.drawString(20*mm,9*mm,f'{VERSION} | {AUDIT_DATE.strftime("%d/%m/%Y")}')
    canvas.restoreState()


def issue_markdown(f):
    locs='\n'.join([f'- `{rel}:{start}` - {note}' for rel,start,end,note in f['evidence']])
    snippets=[]
    for rel,start,end,note in f['evidence'][:3]:
        snippets.append(f'**{rel}:{start}-{end}**\n```text\n{read_lines(rel,start,end)}\n```')
    criteria='\n'.join([f'- [ ] {x}' for x in f['acceptance']])
    return f'''--- ISSUE {f['id']} ---
# [Segurança] {f['title']}

**Labels sugeridas:** `security`, `{f['severity'].lower()}`

## Descrição
{f['summary']}

## Por que é explorável
{f['exploit']}

## Evidência
{locs}

{chr(10).join(snippets)}

## Impacto
{f['impact']}

## Sugestão de correção
{f['fix']}

## Critérios de aceite
{criteria}
--- FIM ISSUE {f['id']} ---'''


def build_pdf(route_count: int):
    register_fonts(); S=styles()
    with tempfile.TemporaryDirectory(prefix='ginga-security-audit-') as td:
        tmp=Path(td); donut,bar=make_charts(tmp)
        doc=SimpleDocTemplate(str(PDF_PATH),pagesize=A4,rightMargin=20*mm,leftMargin=20*mm,topMargin=20*mm,bottomMargin=18*mm,
                              title=f'Relatório de Auditoria de Segurança - {PROJECT}',author='OpenAI - revisão estática assistida')
        story=[]
        # Cover
        story += [Spacer(1,25*mm), P('RELATÓRIO DE AUDITORIA DE SEGURANÇA', ParagraphStyle('kicker',parent=S['body'],fontName='AuditSans-Bold',fontSize=9,tracking=1.5,textColor=HexColor(PALETTE['Brand']))), Spacer(1,5*mm),
                  P(f'Relatório de Auditoria de Segurança — {PROJECT}',S['coverTitle']),
                  P(f'Versão auditada: {VERSION}',S['coverSub']),
                  P(f'Data: {AUDIT_DATE.strftime("%d/%m/%Y")}',S['coverSub']), Spacer(1,6*mm),
                  HRFlowable(width='100%',thickness=2,color=HexColor(PALETTE['Brand'])), Spacer(1,7*mm),
                  P('<b>Escopo auditado</b>',S['h3']),
                  P('API Express/TypeScript, Prisma/PostgreSQL, autenticação e sessões, Web React/Vite, Desktop Electron, Socket.IO/LiveKit, Docker Compose/Dockerfiles, Caddy, GitHub Actions, scripts, documentação e variáveis de build do frontend.',S['body']),
                  P('<b>Nota metodológica</b>',S['h3']),
                  P(f'Foram enumeradas {route_count} declarações de handlers HTTP. As cinco categorias solicitadas foram mapeadas para a stack detectada. A revisão é estática e baseada no código real do pacote fornecido; não substitui pentest dinâmico.',S['body']),
                  Spacer(1,5*mm),
                  P('<b>Limitação importante:</b> o ZIP não contém diretório .git. O repositório público informado não pôde ser carregado/fetcheado neste ambiente; portanto o working tree foi escaneado, mas o histórico Git completo por segredos não foi verificado.',S['small']),
                  PageBreak()]

        # Stack + map
        story += [P('1. Stack detectada e mapeamento da auditoria',S['h1'])]
        stack_data=[
            [P('<b>Camada</b>',S['tableBold']),P('<b>Stack verificada</b>',S['tableBold'])],
            [P('Backend',S['table']),P('TypeScript + Node.js 22 + Express 5.1.0',S['table'])],
            [P('Banco/ORM',S['table']),P('PostgreSQL 16 + Prisma 6.19.3; módulos v0.9 também usam SQL parametrizado via $queryRawUnsafe/$executeRawUnsafe',S['table'])],
            [P('Auth',S['table']),P('JWT HS256 (jsonwebtoken), tokenVersion, sessão revogável/lembrada, TOTP 2FA + recovery codes, bot/webhook tokens',S['table'])],
            [P('Frontend',S['table']),P('React 19.1.0 + Vite 7.1.1 + TypeScript',S['table'])],
            [P('Realtime/media',S['table']),P('Socket.IO 4.8.1 + LiveKit',S['table'])],
            [P('Desktop',S['table']),P('Electron 43.4.0 + electron-builder 26.15.3',S['table'])],
            [P('Deploy/CI',S['table']),P('Docker Compose + Dockerfiles + Caddy + GitHub Actions. Helm/Terraform não encontrados.',S['table'])],
            [P('Isolamento de tenant',S['table']),P('Sem RLS. Controle manual server-side por requireGuildMember/requireGuildCapability/requireChannelCapability e filtros guildId/userId.',S['table'])]
        ]
        t=Table(stack_data,colWidths=[38*mm,125*mm],repeatRows=1)
        t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor('#EEF1F6')),('GRID',(0,0),(-1,-1),0.35,HexColor(PALETTE['Line'])),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
        story += [t,Spacer(1,6*mm),P('Como cada categoria foi adaptada',S['h2'])]
        for title,desc in METHOD_MAP:
            story += [P(f'<b>{title}</b>',S['body']),P(desc,S['small'])]
        story += [PageBreak()]

        # Executive
        story += [P('2. Resumo executivo',S['h1'])]
        count_table=Table([
            [severity_cell('Crítica',S['table']),severity_cell('Alta',S['table']),severity_cell('Média',S['table']),severity_cell('Baixa',S['table'])],
            [P('<b>0</b>',S['center']),P('<b>1</b>',S['center']),P('<b>3</b>',S['center']),P('<b>1</b>',S['center'])]
        ],colWidths=[40*mm]*4)
        count_table.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(0,0),HexColor(PALETTE['Crítica'])),('BACKGROUND',(1,0),(1,0),HexColor(PALETTE['Alta'])),('BACKGROUND',(2,0),(2,0),HexColor(PALETTE['Média'])),('BACKGROUND',(3,0),(3,0),HexColor(PALETTE['Baixa'])),
            ('GRID',(0,0),(-1,-1),0.4,HexColor(PALETTE['Line'])),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)
        ]))
        story += [P('Foram confirmados <b>5 achados</b>: 1 alto, 3 médios e 1 baixo. O risco central é a quebra de isolamento entre servidores em referências auxiliares da camada v0.9, incluindo um caso com impacto direto de escalada de permissão via onboarding.',S['body']),count_table,Spacer(1,6*mm)]
        charts=Table([[Image(str(donut),width=75*mm,height=52*mm),Image(str(bar),width=88*mm,height=50*mm)]],colWidths=[78*mm,88*mm])
        charts.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]))
        story += [charts,Spacer(1,4*mm),P('<b>Risco principal:</b> algumas tabelas/rotas auxiliares validam o tenant do recurso pai, mas aceitam IDs relacionados sem verificar que pertencem ao mesmo guild. Isso contorna a camada de autorização centralizada que está correta na maior parte do produto.',S['body']),PageBreak()]

        # strengths weaknesses
        story += [P('3. Pontos fortes e pontos fracos',S['h1']),P('Pontos fortes verificados',S['h2'])]
        strength_rows=[[P('<b>Evidência</b>',S['tableBold']),P('<b>Controle verificado</b>',S['tableBold'])]]
        for name,loc,desc in STRENGTHS:
            strength_rows.append([P(f'<b>{name}</b><br/>{loc}',S['table']),P(desc,S['table'])])
        st=Table(strength_rows,colWidths=[57*mm,106*mm],repeatRows=1)
        st.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor('#E8F7F0')),('GRID',(0,0),(-1,-1),0.35,HexColor(PALETTE['Line'])),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
        story += [st,Spacer(1,6*mm),P('Pontos fracos centrais',S['h2'])]
        for x in WEAK_POINTS: story.append(P('• '+x,S['body']))
        story += [Spacer(1,5*mm),P('Cobertura das rotas',S['h2']),P(f'O backend contém <b>{route_count} declarações de handlers HTTP</b> em 17 arquivos de rotas/index. Cada declaração foi extraída com arquivo, linha, método, path, guards detectados e status de revisão. A matriz completa está em <b>docs/security-audit/cobertura-rotas.csv</b>.',S['body']),PageBreak()]

        # finding table
        story += [P('4. Achados detalhados',S['h1'])]
        data=[[P('<b>Severidade</b>',S['tableBold']),P('<b>Arquivo:linha</b>',S['tableBold']),P('<b>Descrição</b>',S['tableBold'])]]
        for f in FINDINGS:
            rel,start,_,_=f['evidence'][0]
            data.append([severity_cell(f['severity'],S['table']),P(f'{rel}:{start}',S['table']),P(f'<b>{f["id"]} - {f["title"]}</b><br/>{f["summary"]}',S['table'])])
        tab=Table(data,colWidths=[25*mm,50*mm,88*mm],repeatRows=1)
        cmds=[('BACKGROUND',(0,0),(-1,0),HexColor('#EEF1F6')),('GRID',(0,0),(-1,-1),0.35,HexColor(PALETTE['Line'])),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]
        for i,f in enumerate(FINDINGS, start=1): cmds.append(('BACKGROUND',(0,i),(0,i),HexColor(PALETTE[f['severity']])))
        tab.setStyle(TableStyle(cmds)); story += [tab,Spacer(1,7*mm)]

        for idx,f in enumerate(FINDINGS):
            story += [P(f'{f["id"]}. {f["title"]}',S['h2'])]
            meta=Table([[severity_cell(f['severity'],S['table']),P(f'<b>Categoria:</b> {f["category"]}',S['table'])]],colWidths=[27*mm,136*mm])
            meta.setStyle(TableStyle([('BACKGROUND',(0,0),(0,0),HexColor(PALETTE[f['severity']])),('BACKGROUND',(1,0),(1,0),HexColor('#F8FAFC')),('BOX',(0,0),(-1,-1),0.4,HexColor(PALETTE['Line'])),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
            story += [meta,Spacer(1,3*mm),P(f['summary'],S['body']),P('<b>Por que é explorável</b>',S['h3']),P(f['exploit'],S['body']),P('<b>Impacto</b>',S['h3']),P(f['impact'],S['body']),P('<b>Evidência linha por linha</b>',S['h3'])]
            for rel,start,end,note in f['evidence']:
                story += [P(f'<b>{rel}:{start}-{end}</b> - {note}',S['small']),code_flow(read_lines(rel,start,end),S['code'])]
            story += [P('<b>Correção recomendada</b>',S['h3']),P(f['fix'],S['body'])]
            if idx < len(FINDINGS)-1: story += [HRFlowable(width='100%',thickness=.7,color=HexColor(PALETTE['Line'])),Spacer(1,3*mm)]
        story += [PageBreak()]

        # XSS category no finding
        story += [P('5. Categoria sem achado explorável: XSS',S['h1']),P('Nenhum XSS explorável foi confirmado nos sinks revisados.',S['body'])]
        xss_rows=[
            ['Ponto','Evidência','Resultado'],
            ['Mensagens/markdown','MessageContent.tsx:7,40-64,125-139','React nodes; links reconhecidos apenas como http/https e revalidados antes de abrir.'],
            ['Gaming profile innerHTML','gamingProfile.ts:63-65,158-164,186-242,407','Campos interpolados passam por escapeHtml; elementos fixos são template local.'],
            ['Overlay Electron','game-overlay.html:30-61','Strings de jogo/canal/participante/avatar passam por esc antes de innerHTML.'],
            ['E-mails','auth.ts:228-235,291-306; registrationVerification.ts:108-127','displayName, URL e código são escapados antes de HTML.'],
            ['eval/new Function/dangerouslySetInnerHTML','Busca global em apps/web/src, apps/desktop/src e apps/api/src','Nenhuma ocorrência de eval/new Function/dangerouslySetInnerHTML.']
        ]
        xd=[[P(f'<b>{c}</b>',S['tableBold']) for c in xss_rows[0]]]
        for row in xss_rows[1:]: xd.append([P(row[0],S['table']),P(row[1],S['table']),P(row[2],S['table'])])
        xt=Table(xd,colWidths=[37*mm,57*mm,69*mm],repeatRows=1)
        xt.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor('#E8F7F0')),('GRID',(0,0),(-1,-1),0.35,HexColor(PALETTE['Line'])),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
        story += [xt,Spacer(1,5*mm),P('<b>Observação:</b> não foi encontrada biblioteca dedicada de sanitização (ex.: DOMPurify). Isso não foi reportado como falha porque os sinks encontrados têm escape/allowlist verificável; uma lib dedicada pode ser adotada como defesa em profundidade em futuras telas que renderizem HTML arbitrário.',S['small']),PageBreak()]

        # Recommendations + limitations
        story += [P('6. Recomendações priorizadas',S['h1'])]
        rec_data=[[P('<b>Prioridade</b>',S['tableBold']),P('<b>Ação</b>',S['tableBold']),P('<b>Resultado esperado</b>',S['tableBold'])]]
        for pr,title,desc in RECOMMENDATIONS: rec_data.append([P(f'<b>{pr}</b>',S['table']),P(title,S['table']),P(desc,S['table'])])
        rt=Table(rec_data,colWidths=[22*mm,48*mm,93*mm],repeatRows=1)
        rt.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor('#EEF1F6')),('GRID',(0,0),(-1,-1),0.35,HexColor(PALETTE['Line'])),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
        story += [rt,Spacer(1,6*mm),P('Limitações e condições de cobertura',S['h2']),P('• Auditoria estática: não foram executados ataques contra um ambiente de produção nem fuzzing dinâmico.',S['body']),P('• O pacote auditado não contém .git. O working tree foi escaneado por marcadores/segredos e variáveis VITE, porém o histórico de commits não pôde ser confirmado.',S['body']),P('• O repositório público informado (GabrielBosco/ginga) não pôde ser carregado pelo acesso de rede disponível nesta execução; por isso nenhuma afirmação de “histórico limpo” é feita.',S['body']),P('• Endpoints públicos de mídia com etag/accessKey foram tratados como recursos tokenizados, não como IDOR, porque o segredo/etag faz parte do controle de acesso e foi verificado em código.',S['body']),PageBreak()]

        # Issues
        story += [P('7. ISSUES PARA O GITHUB',S['h1']),P('Blocos completos em Markdown, prontos para copiar e colar. Achados sistêmicos relacionados foram agrupados para evitar spam.',S['body'])]
        for f in FINDINGS:
            story += [P(f'Issue {f["id"]}',S['h2']),code_flow(issue_markdown(f),S['issue']),Spacer(1,4*mm)]

        doc.build(story,onFirstPage=header_footer,onLaterPages=header_footer)


def main():
    HERE.mkdir(parents=True,exist_ok=True)
    rows=write_route_csv()
    if len(rows) != 288:
        raise SystemExit(f'Cobertura inesperada: {len(rows)} handlers; esperado 288 para esta revisão.')
    build_pdf(len(rows))
    print(PDF_PATH)
    print(ROUTE_CSV)

if __name__=='__main__':
    main()
