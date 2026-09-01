import { useMemo, useState, type ReactNode } from "react";
import {
  BookOpen, Bot, CalendarDays, Check, ChevronRight, Code2, Copy, ExternalLink, Github,
  Headphones, Home, KeyRound, MessageCircleMore, Search, Server, ShieldCheck, TerminalSquare,
  UsersRound, Webhook, Wrench
} from "lucide-react";

type KnowledgeBaseProps = { onExit: () => void; authenticated?: boolean };
type Audience = "user" | "dev";
type Article = { id:string; audience:Audience; category:string; title:string; summary:string; keywords:string[]; icon:ReactNode; content:ReactNode };

const botStarter = `import os
import gingabot

intents = gingabot.Intents.default()
intents.message_content = True

bot = gingabot.Bot(
    command_prefix="!",
    intents=intents,
    server_url=os.environ["GINGA_SERVER"],
)

@bot.event
async def on_ready():
    print(f"Online como {bot.user}")

@bot.command()
async def ping(ctx):
    await ctx.reply("Pong!")

bot.run(os.environ["GINGA_BOT_TOKEN"])`;

const webhookExample = `curl -X POST "$GINGA_SERVER/api/webhooks/WEBHOOK_ID" \\
  -H "Authorization: Bearer $GINGA_WEBHOOK_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"content":"Deploy concluido"}'`;

function CodeBlock({ code }: { code:string }) {
  return <div className="kb-code-block" data-copy-code={code}><button type="button"><Copy size={14}/> Copiar</button><pre><code>{code}</code></pre></div>;
}
function Steps({ children }: { children:ReactNode }) { return <ol className="kb-steps">{children}</ol>; }

const articles:Article[] = [
  { id:"primeiros-passos", audience:"user", category:"Comece aqui", title:"Primeiros passos", summary:"Conta, convite, servidor e onde ficam as coisas.", keywords:["inicio","conta","convite","servidor"], icon:<Home size={18}/>, content:<>
    <h2>Entrar no Ginga</h2><Steps>
      <li><b>1</b><div><strong>Crie a conta</strong><span>Escolha seu nome, @usuario, e-mail, data de nascimento e senha. O cadastro exige 16 anos ou mais e o @usuario fica permanente.</span></div></li>
      <li><b>2</b><div><strong>Confirme o e-mail</strong><span>Digite o codigo de 6 digitos enviado para sua caixa de entrada.</span></div></li>
      <li><b>3</b><div><strong>Adicione um servidor</strong><span>Use o botao + para criar um servidor ou entrar com um convite.</span></div></li>
      <li><b>4</b><div><strong>Abra um canal</strong><span>Canais de texto ficam para mensagens; canais de voz ficam para chamada, camera e compartilhamento.</span></div></li>
    </Steps>
    <div className="kb-callout"><Check size={17}/><div><strong>Conta nova vem limpa</strong><span>O Ginga nao cria servidor automaticamente. Voce escolhe onde entrar.</span></div></div>
  </> },
  { id:"conta-seguranca", audience:"user", category:"Sua conta", title:"Senha, e-mail e 2FA", summary:"Como proteger a conta e recuperar o acesso.", keywords:["senha","2fa","autenticador","email","invasao","recuperacao"], icon:<KeyRound size={18}/>, content:<>
    <h2>Ative a verificacao em duas etapas</h2><p>Em <b>Configuracoes → Seguranca</b>, ative o 2FA usando Google Authenticator, Microsoft Authenticator, Authy ou outro app TOTP.</p>
    <div className="kb-callout warning"><ShieldCheck size={17}/><div><strong>Por que usar 2FA?</strong><span>Se sua senha vazar ou for roubada, o invasor ainda precisara do codigo do seu autenticador.</span></div></div>
    <h3>Codigos de recuperacao</h3><p>Ao ativar o 2FA, salve os codigos de recuperacao. Cada um funciona uma unica vez se voce perder o celular.</p>
    <h3>Trocar a senha</h3><p>A troca e feita por link enviado ao e-mail da conta. O link expira em 30 minutos e deixa de funcionar depois do uso.</p>
    <h3>Senha vazada</h3><p>O Ginga recusa senhas que aparecem em bases publicas de vazamentos conhecidos. A senha inteira nao e enviada para o servico de consulta.</p>
  </> },
  { id:"amigos-dm", audience:"user", category:"Conversas", title:"Amigos e mensagens diretas", summary:"Encontrar pessoas, aceitar pedidos e conversar no privado.", keywords:["amigo","dm","privado","pedido","pessoa"], icon:<UsersRound size={18}/>, content:<>
    <h2>Encontrar uma pessoa</h2><p>Abra <b>Pessoas</b> e use a busca do topo. Procure pelo nome ou por <code>@usuario</code> e envie a solicitacao.</p>
    <h3>Mensagens diretas</h3><p>Depois que a conversa existir, ela aparece em Conversas. Clique no nome para abrir o historico.</p>
    <h3>Bloquear alguem</h3><p>Abra o perfil ou menu da pessoa e use Bloquear. O usuario bloqueado aparece na aba <b>Bloqueados</b>.</p>
  </> },
  { id:"mensagens", audience:"user", category:"Conversas", title:"Mensagens, mencoes e arquivos", summary:"Responder, reagir, mencionar e enviar anexos.", keywords:["mensagem","reacao","mencao","arquivo","pdf","imagem"], icon:<MessageCircleMore size={18}/>, content:<>
    <h2>Mensagens</h2><p>Passe o mouse ou abra o menu da mensagem para responder, reagir, salvar e usar outras acoes permitidas.</p>
    <h3>Mencionar alguem</h3><p>Digite <code>@</code> e escolha uma pessoa da lista. O Ginga nao cria mencao para usuario inexistente.</p>
    <h3>Arquivos</h3><p>O servidor aceita os formatos e tamanhos configurados pelo administrador. O arquivo e validado antes de ser armazenado.</p>
  </> },
  { id:"voz-video-tela", audience:"user", category:"Chamadas", title:"Voz, video e compartilhar tela", summary:"Entrar em voz, escolher dispositivos e resolver os problemas mais comuns.", keywords:["voz","microfone","camera","tela","ptt","audio"], icon:<Headphones size={18}/>, content:<>
    <h2>Entrar em uma sala</h2><p>Clique no canal de voz. Quando a conexao terminar, os controles de microfone, audio, camera e tela ficam disponiveis.</p>
    <h3>Microfone errado</h3><p>Abra <b>Configuracoes → Voz e video</b>, escolha o microfone e rode o teste. Se sua voz estiver muito baixa, ajuste <b>Sensibilidade do microfone</b>; 50% mantem o ganho original.</p>
    <h3>Push-to-Talk</h3><p>Ative o modo de entrada, clique em <b>Alterar</b> e pressione qualquer tecla ou botao do mouse que voce queira usar. O Ginga mostra o atalho escolhido antes de voce entrar na chamada.</p>
    <h3>Ninguem me escuta</h3><p>Confira se o microfone nao esta mutado, se o dispositivo certo esta selecionado e se o sistema permitiu acesso ao microfone.</p><h3>Compartilhamento com movimento travado</h3><p>Em <b>Configuracoes → Voz e video</b>, escolha a qualidade e os FPS da transmissao. Para jogos e movimento rapido, 60 FPS prioriza fluidez; 1080p exige uma conexao de upload estavel.</p>
  </> },
  { id:"servidores-canais", audience:"user", category:"Servidores", title:"Servidores, categorias e canais", summary:"Como organizar sua comunidade sem se perder.", keywords:["servidor","categoria","canal","texto","voz"], icon:<Server size={18}/>, content:<>
    <h2>Categorias</h2><p>Use categorias para separar assuntos, por exemplo: Informacoes, Comunidade, Jogos e Staff.</p>
    <h3>Canais</h3><ul className="kb-feature-list"><li><b>Texto:</b> conversa e arquivos.</li><li><b>Voz:</b> chamada, camera e tela.</li><li><b>Anuncios:</b> comunicados.</li><li><b>Forum:</b> assuntos separados por topico.</li><li><b>Eventos:</b> agenda e confirmacao de presenca.</li></ul>
  </> },
  { id:"cargos-moderacao", audience:"user", category:"Servidores", title:"Cargos e moderacao", summary:"Permissoes, hierarquia, expulsao, ban e movimentacao em voz.", keywords:["cargo","moderacao","ban","expulsar","mover","permissao"], icon:<ShieldCheck size={18}/>, content:<>
    <h2>Cargos</h2><p>Cargos definem o que cada grupo pode fazer. Evite dar Administrador quando uma permissao menor resolve.</p>
    <h3>Moderacao</h3><p>Dependendo do seu cargo, o menu de um membro pode permitir mover de sala, desconectar da voz, expulsar ou banir.</p>
    <h3>Seguranca do servidor</h3><p>A tela de seguranca mostra AutoMod, convites permanentes, equipe administrativa e integracoes. Ela mostra somente itens que o dono da comunidade consegue controlar.</p>
  </> },
  { id:"eventos", audience:"user", category:"Servidores", title:"Eventos e forum", summary:"Criar agenda, confirmar presenca e organizar discussoes.", keywords:["evento","forum","agenda","topico"], icon:<CalendarDays size={18}/>, content:<>
    <h2>Eventos</h2><p>Informe titulo, descricao, local, inicio e fim. Depois os membros podem marcar presenca ou interesse.</p>
    <h2>Forum</h2><p>Use forum quando cada assunto precisa de uma conversa propria, sem misturar tudo em um unico canal.</p>
  </> },
  { id:"resolver-problemas", audience:"user", category:"Ajuda", title:"Quando alguma coisa nao funciona", summary:"Checklist curto antes de chamar o administrador.", keywords:["erro","problema","nao funciona","cache","voz"], icon:<Wrench size={18}/>, content:<>
    <h2>Antes de tudo</h2><Steps>
      <li><b>1</b><div><strong>Atualize a tela</strong><span>No navegador use Ctrl+Shift+R. No desktop feche e abra o Ginga.</span></div></li>
      <li><b>2</b><div><strong>Confira sua Internet</strong><span>Teste outro site e veja se a conexao esta estavel.</span></div></li>
      <li><b>3</b><div><strong>Teste outro dispositivo de audio</strong><span>Se o problema for voz, confirme microfone e saida em Configuracoes.</span></div></li>
      <li><b>4</b><div><strong>Anote a mensagem de erro</strong><span>Ela ajuda o administrador a identificar o problema sem adivinhar.</span></div></li>
    </Steps>
  </> },

  { id:"dev-primeiros-passos", audience:"dev", category:"Comece aqui", title:"Criar um bot do zero", summary:"Da criacao no Portal Developer ate o primeiro processo Python conectado.", keywords:["bot","developer","token","python","instalar","quickstart"], icon:<Bot size={18}/>, content:<>
    <h2>Fluxo oficial</h2><Steps>
      <li><b>1</b><div><strong>Abra Ginga Developer</strong><span>No Ginga, entre no Portal Developer e abra <b>Bots Python</b>.</span></div></li>
      <li><b>2</b><div><strong>Crie o bot</strong><span>Informe nome, descricao e escolha um preset inicial. As permissoes podem ser revisadas antes da instalacao.</span></div></li>
      <li><b>3</b><div><strong>Copie o token</strong><span>O token aparece apenas na criacao ou rotacao. Guarde em variavel de ambiente ou secret manager.</span></div></li>
      <li><b>4</b><div><strong>Instale no servidor</strong><span>Escolha o servidor e autorize somente as permissoes necessarias.</span></div></li>
      <li><b>5</b><div><strong>Configure os intents</strong><span>Se o bot usa comandos por texto, habilite Conteudo de mensagens no Portal e no codigo.</span></div></li>
      <li><b>6</b><div><strong>Instale o SDK</strong><span>Use <code>python -m pip install -U ginga-bot</code>. O import oficial e <code>gingabot</code>.</span></div></li>
      <li><b>7</b><div><strong>Execute o processo</strong><span>Rode o bot em Python, VM ou container. Depois teste <code>!ping</code> em um canal acessivel.</span></div></li>
    </Steps>
    <div className="kb-callout"><Check size={17}/><div><strong>SDK oficial</strong><span>Distribuicao: <code>ginga-bot</code>. Modulo: <code>gingabot</code>. Python 3.10 ou superior.</span></div></div>
  </> },
  { id:"bot-python-install", audience:"dev", category:"Bots", title:"Instalar o Ginga Bot SDK", summary:"Windows, Linux, validacao e solucao para No matching distribution found.", keywords:["pip","pypi","instalar","gingabot","ginga-bot","no matching distribution"], icon:<TerminalSquare size={18}/>, content:<>
    <h2>Requisito</h2><CodeBlock code={`python --version`}/><p>O SDK exige <b>Python 3.10+</b>. Prefira um ambiente virtual por bot.</p>
    <h3>Windows PowerShell</h3><CodeBlock code={`python -m venv .venv\n.\\.venv\\Scripts\\Activate.ps1\npython -m pip install --upgrade pip\npython -m pip install -U ginga-bot`}/>
    <h3>Linux</h3><CodeBlock code={`python3 -m venv .venv\nsource .venv/bin/activate\npython -m pip install --upgrade pip\npython -m pip install -U ginga-bot`}/>
    <h3>Confirme o modulo instalado</h3><CodeBlock code={`python -c "import gingabot; print(gingabot.__version__)"`}/>
    <h3>Se o pip nao encontrar o pacote</h3><p>Algumas maquinas usam mirror, indice corporativo ou configuracao global diferente do PyPI oficial.</p><CodeBlock code={`python -m pip config list\npython -m pip install --no-cache-dir --index-url https://pypi.org/simple ginga-bot`}/>
    <div className="kb-callout warning"><ShieldCheck size={17}/><div><strong>Nao instale o pacote chamado apenas ginga</strong><span>O SDK do chat e <code>ginga-bot</code> e o import e <code>gingabot</code>. O namespace Python <code>ginga</code> pertence a outro projeto.</span></div></div>
  </> },
  { id:"bot-python", audience:"dev", category:"Bots", title:"Primeiro bot: !ping", summary:"Token, variaveis de ambiente, MESSAGE_CONTENT e um bot funcional.", keywords:["python","gingabot","ginga-bot","ping","sdk","token","message_content"], icon:<TerminalSquare size={18}/>, content:<>
    <h2>Variaveis de ambiente</h2><p><code>GINGA_SERVER</code> aponta para a URL base do seu Ginga. Nao acrescente <code>/api</code>.</p>
    <h3>PowerShell</h3><CodeBlock code={`$env:GINGA_SERVER="https://seu-servidor-ginga.exemplo"\n$env:GINGA_BOT_TOKEN="cole_o_token_aqui"`}/>
    <h3>Linux</h3><CodeBlock code={`export GINGA_SERVER="https://seu-servidor-ginga.exemplo"\nexport GINGA_BOT_TOKEN="cole_o_token_aqui"`}/>
    <h2>bot.py</h2><CodeBlock code={botStarter}/>
    <h2>Execute</h2><CodeBlock code={`python bot.py`}/><p>Depois envie <code>!ping</code> em um canal onde o bot tenha acesso. A resposta esperada e <code>Pong!</code>.</p>
    <div className="kb-callout warning"><ShieldCheck size={17}/><div><strong>MESSAGE_CONTENT precisa dos dois lados</strong><span>Use <code>intents.message_content = True</code> no Python e habilite <b>Conteudo de mensagens</b> no Portal Developer.</span></div></div>
    <p>O token pertence ao bot. Nao use token de usuario e nunca envie a credencial para GitHub, frontend, screenshot ou log.</p>
  </> },
  { id:"bot-python-comandos", audience:"dev", category:"Bots", title:"Comandos e eventos no Python", summary:"Decorators, argumentos tipados, mensagens e eventos do Gateway.", keywords:["command","event","on_message","on_ready","ctx","argumentos"], icon:<Code2 size={18}/>, content:<>
    <h2>Comandos</h2><CodeBlock code={`@bot.command(description="Soma dois numeros")\nasync def somar(ctx, a: int, b: int):\n    await ctx.reply(str(a + b))`}/><p>O SDK converte automaticamente <code>str</code>, <code>int</code>, <code>float</code> e <code>bool</code>.</p>
    <h3>Texto restante</h3><CodeBlock code={`@bot.command()\nasync def falar(ctx, *, texto: str):\n    await ctx.send(texto)`}/>
    <h2>Eventos</h2><CodeBlock code={`@bot.event\nasync def on_ready():\n    print(bot.user)\n\n@bot.event\nasync def on_message(message):\n    print(message.author, message.content)\n\n@bot.event\nasync def on_voice_state_update(payload):\n    print(payload)`}/>
    <h3>Erro de comando</h3><CodeBlock code={`@bot.event\nasync def on_command_error(ctx, error):\n    await ctx.reply(f"Nao consegui executar: {error}")`}/>
  </> },
  { id:"bot-python-erros", audience:"dev", category:"Bots", title:"Erros comuns do Ginga Bot SDK", summary:"Checklist para pip, token, permissao, MESSAGE_CONTENT e reconexao.", keywords:["erro","401","403","pip","pypi","token","reconexao","websocket"], icon:<Wrench size={18}/>, content:<>
    <h2>ModuleNotFoundError: gingabot</h2><CodeBlock code={`python -m pip show ginga-bot\npython -c "import sys; print(sys.executable)"`}/><p>Instale e execute usando o mesmo Python/ambiente virtual.</p>
    <h2>No matching distribution found</h2><CodeBlock code={`python --version\npython -m pip install --no-cache-dir --index-url https://pypi.org/simple ginga-bot`}/><p>Confirme Python 3.10+ e se a maquina usa um indice privado.</p>
    <h2>HTTP 401</h2><p>Token ausente, invalido ou rotacionado. Atualize <code>GINGA_BOT_TOKEN</code>.</p>
    <h2>HTTP 403</h2><p>O bot autenticou, mas nao tem permissao efetiva. Revise instalacao, permissoes, cargo e ACL do canal.</p>
    <h2>Bot conecta mas !ping nao responde</h2><ul className="kb-feature-list"><li><code>intents.message_content = True</code> no codigo.</li><li><b>Conteudo de mensagens</b> habilitado no Portal Developer.</li><li>Bot instalado no servidor correto.</li><li>Canal visivel para o bot.</li><li>Permissoes de leitura e envio.</li><li>Prefixo correto.</li></ul>
    <h2>Reconexao constante</h2><p>Confira <code>GINGA_SERVER</code>, HTTPS/WSS, WebSocket no proxy/firewall e logs da API.</p>
  </> },
  { id:"dev-ids", audience:"dev", category:"Bots", title:"IDs e objetos", summary:"Use IDs para nao quebrar integracoes quando nomes mudarem.", keywords:["id","guild","channel","role","user"], icon:<Code2 size={18}/>, content:<>
    <h2>Ative o Modo Desenvolvedor</h2><p>Em <b>Configuracoes → Desenvolvedor</b>, ative o modo e use o menu de contexto para copiar IDs.</p>
    <ul className="kb-feature-list"><li><b>User ID:</b> identifica a conta.</li><li><b>Guild ID:</b> identifica o servidor.</li><li><b>Channel ID:</b> identifica o canal.</li><li><b>Role ID:</b> identifica o cargo.</li></ul>
    <p>Nome exibido, nome de canal e nome de cargo podem mudar. IDs nao.</p>
  </> },
  { id:"dev-permissoes", audience:"dev", category:"Bots", title:"Intents e permissoes", summary:"Diferenca entre receber evento e poder executar uma acao.", keywords:["intent","permission","acl","mensagem"], icon:<ShieldCheck size={18}/>, content:<>
    <h2>Intents</h2><p>Intents dizem quais eventos o bot quer receber. Por exemplo, <code>MESSAGE_CONTENT</code> e necessario para ler o conteudo de mensagens quando esse recurso estiver habilitado.</p>
    <h2>Permissoes</h2><p>Permissoes dizem o que o bot pode fazer no servidor. Ter um intent nao ignora a ACL do canal nem a permissao aprovada na instalacao.</p>
    <div className="kb-callout warning"><ShieldCheck size={17}/><div><strong>Menor privilegio</strong><span>Solicite somente o que seu bot usa. Isso reduz impacto caso o token vaze.</span></div></div>
  </> },
  { id:"dev-webhooks", audience:"dev", category:"Integracoes", title:"Webhooks", summary:"Enviar mensagens sem manter um bot conectado.", keywords:["webhook","ci","alerta","token"], icon:<Webhook size={18}/>, content:<>
    <h2>Quando usar</h2><p>Webhook e ideal para CI/CD, monitoramento e alertas que apenas publicam mensagens.</p>
    <CodeBlock code={webhookExample}/>
    <p>O segredo vai no header <code>Authorization</code>. Nao coloque segredo na URL.</p>
  </> },
  { id:"dev-api", audience:"dev", category:"Integracoes", title:"REST e Gateway", summary:"Como o bot conversa com o Ginga.", keywords:["api","rest","socket","gateway"], icon:<Code2 size={18}/>, content:<>
    <h2>REST</h2><p>Use REST para comandos e alteracoes explicitas: enviar mensagem, consultar recurso, moderar ou gerenciar configuracao permitida.</p>
    <h2>Gateway</h2><p>Use o Gateway para receber eventos em tempo real. O SDK cuida da sessao, reconexao e intents.</p>
    <h3>Boas praticas</h3><ul className="kb-feature-list"><li>Timeout em toda chamada externa.</li><li>Retry com backoff, nunca loop agressivo.</li><li>Nao responda a mensagem do proprio bot em loop.</li><li>Rotacione o token imediatamente se houver vazamento.</li></ul>
  </> },
  { id:"dev-gateway-events", audience:"dev", category:"Integracoes", title:"Eventos do Gateway", summary:"Eventos reais entregues pelo Ginga para bots conectados.", keywords:["gateway","socket","eventos","bot:ready","guild:message:new","voice:presence"], icon:<Code2 size={18}/>, content:<>
    <h2>Eventos principais</h2><ul className="kb-feature-list"><li><code>bot:ready</code> — enviado quando o bot autentica; inclui applicationId, clientId, guildIds e intents.</li><li><code>guild:message:new</code> — nova mensagem de servidor quando o bot possui os intents e permissoes necessarios.</li><li><code>voice:presence</code> — atualizacao de presenca em voz para bots com acesso a estados de voz.</li></ul>
    <h3>Mensagem de servidor</h3><CodeBlock code={`{
  "messageId": "...",
  "channelId": "...",
  "channelName": "geral",
  "guildId": "...",
  "authorId": "...",
  "content": "ola",
  "hasAttachments": false,
  "createdAt": "2026-08-26T...Z"
}`}/>
    <div className="kb-callout"><ShieldCheck size={17}/><div><strong>ACL continua valendo</strong><span>Instalar o bot nao ignora a permissao real do canal. Sem VIEW_CHANNELS e os intents corretos, o evento nao e entregue.</span></div></div>
  </> },
  { id:"dev-seguranca", audience:"dev", category:"Producao", title:"Checklist de producao", summary:"O minimo antes de deixar um bot rodando 24/7.", keywords:["producao","seguranca","token","logs"], icon:<ShieldCheck size={18}/>, content:<>
    <h2>Antes de publicar</h2><ul className="kb-feature-list"><li>Token em variavel de ambiente ou secret manager.</li><li>Nada de token no Git, frontend ou screenshot.</li><li>Logs sem Authorization/header sensivel.</li><li>Permissoes minimas.</li><li>Tratamento de rate limit e reconexao.</li><li>Processo com restart controlado.</li></ul>
  </> }
];

const categoryOrder:Record<Audience,string[]> = {
  user:["Comece aqui","Sua conta","Conversas","Chamadas","Servidores","Ajuda"],
  dev:["Comece aqui","Bots","Integracoes","Producao"]
};

export function KnowledgeBase({ onExit, authenticated=false }:KnowledgeBaseProps) {
  const params = new URLSearchParams(location.search);
  const requestedId = params.get("article") || "";
  const initial = articles.find((article) => article.id === requestedId) ?? articles[0];
  const [audience,setAudience] = useState<Audience>(initial.audience);
  const [selectedId,setSelectedId] = useState(initial.id);
  const [query,setQuery] = useState("");
  const [copied,setCopied] = useState(false);
  const githubUrl = String(import.meta.env.VITE_GITHUB_REPOSITORY_URL ?? "").trim();

  const visible = useMemo(() => {
    const needle=query.trim().toLocaleLowerCase("pt-BR");
    return articles.filter((article) => article.audience===audience && (!needle || [article.title,article.summary,article.category,...article.keywords].join(" ").toLocaleLowerCase("pt-BR").includes(needle)));
  },[audience,query]);
  const selected = articles.find((article) => article.id===selectedId && article.audience===audience) ?? articles.find((article)=>article.audience===audience)!;

  function switchAudience(next:Audience) { setAudience(next); setQuery(""); const first=articles.find((article)=>article.audience===next)!; setSelectedId(first.id); const url=new URL(location.href); url.pathname="/knowledge"; url.searchParams.set("article",first.id); history.replaceState({},"",url); }
  function selectArticle(id:string) { setSelectedId(id); const url=new URL(location.href); url.pathname="/knowledge"; url.searchParams.set("article",id); history.replaceState({},"",url); document.querySelector(".kb-main")?.scrollTo({top:0,behavior:"smooth"}); }
  async function copy(code:string) { try { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(()=>setCopied(false),1400); } catch { setCopied(false); } }

  return <main className="knowledge-page">
    <header className="kb-topbar"><button className="kb-brand" type="button" onClick={onExit}><img src="/ginga-mark.svg" alt=""/><span><strong>Ginga</strong><small>Base de conhecimento</small></span></button><div className="kb-top-actions">{githubUrl&&<a href={githubUrl} target="_blank" rel="noreferrer"><Github size={16}/> GitHub <ExternalLink size={13}/></a>}<button type="button" onClick={onExit}>{authenticated?"Voltar ao Ginga":"Entrar no Ginga"}</button></div></header>
    <div className="kb-audience-switch"><button className={audience==="user"?"active":""} onClick={()=>switchAudience("user")}><BookOpen size={16}/><span><strong>Ajuda do Ginga</strong><small>Para quem usa o aplicativo</small></span></button><button className={audience==="dev"?"active":""} onClick={()=>switchAudience("dev")}><Code2 size={16}/><span><strong>Ginga Developer</strong><small>Bots, API e integracoes</small></span></button></div>
    <div className="kb-layout"><aside className="kb-sidebar"><div className="kb-search"><Search size={17}/><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder={audience==="user"?"O que voce precisa?":"Buscar na documentacao dev..."}/></div><nav>{categoryOrder[audience].map((category)=>{const items=visible.filter((article)=>article.category===category); if(!items.length)return null; return <section key={category}><small>{category}</small>{items.map((article)=><button key={article.id} type="button" className={selected.id===article.id?"active":""} onClick={()=>selectArticle(article.id)}><span>{article.icon}</span><div><strong>{article.title}</strong><em>{article.summary}</em></div><ChevronRight size={14}/></button>)}</section>})}{visible.length===0&&<div className="kb-no-results"><Search size={20}/><strong>Nada encontrado</strong><span>Tente outra palavra.</span></div>}</nav></aside>
      <section className="kb-main"><div className="kb-breadcrumb"><BookOpen size={14}/><span>{audience==="user"?"Ajuda":"Developer"}</span><ChevronRight size={13}/><b>{selected.category}</b></div><article className="kb-article"><header><span className="kb-article-icon">{selected.icon}</span><div><small>{selected.category}</small><h1>{selected.title}</h1><p>{selected.summary}</p></div></header><div className="kb-article-body" onClick={(event)=>{const target=event.target as HTMLElement; const block=target.closest<HTMLElement>(".kb-code-block"); const button=target.closest<HTMLButtonElement>(".kb-code-block > button"); if(!button||!block)return; const value=block.dataset.copyCode??block.querySelector("pre code")?.textContent??""; if(value)void copy(value);}}>{selected.content}</div><footer><span>{audience==="user"?"Ajuda da versao atual do Ginga.":"Documentacao do Ginga Developer."} <a href="/privacy">Privacidade</a> · <a href="/terms">Termos de Uso</a></span><button type="button" onClick={onExit}>Voltar ao sistema</button></footer></article></section>
    </div>{copied&&<div className="kb-copy-toast"><Check size={15}/> Copiado</div>}
  </main>;
}
