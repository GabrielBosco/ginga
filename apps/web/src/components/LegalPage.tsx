import { ArrowLeft, BookOpen, Database, FileText, LockKeyhole, Mail, ShieldCheck, UserRoundCheck } from "lucide-react";

type LegalPageProps = {
  kind: "terms" | "privacy";
  onExit: () => void;
};

type Section = {
  id: string;
  title: string;
  body: React.ReactNode;
};

const UPDATED_AT = "1 de setembro de 2026";

const termsSections: Section[] = [
  {
    id: "aceite",
    title: "1. Aceite e idade minima",
    body: <>
      <p>Ao criar uma conta ou usar o Ginga, voce concorda com estes Termos de Uso e com a Politica de Privacidade. O cadastro de contas humanas e permitido somente para pessoas com <strong>16 anos ou mais</strong>.</p>
      <p>O operador desta instancia pode solicitar medidas razoaveis para confirmar a seguranca de uma conta ou impedir uso que viole estes termos.</p>
    </>
  },
  {
    id: "conta",
    title: "2. Sua conta",
    body: <>
      <p>Voce e responsavel por manter sua senha, codigos de recuperacao e dispositivos confiaveis protegidos. Nao compartilhe credenciais com terceiros.</p>
      <p>Informacoes de cadastro devem ser verdadeiras o suficiente para permitir o funcionamento e a seguranca da conta. Nao tente contornar a verificacao de idade, e-mail ou outros mecanismos de protecao.</p>
    </>
  },
  {
    id: "uso",
    title: "3. Uso aceitavel",
    body: <>
      <p>Use o Ginga de forma legal e respeitosa. Nao use o servico para invadir sistemas, distribuir malware, praticar fraude, assediar pessoas, explorar menores, violar direitos de terceiros ou tentar degradar deliberadamente a infraestrutura.</p>
      <p>Automacoes, bots, webhooks e integracoes devem respeitar os limites tecnicos e as permissoes concedidas no servidor.</p>
    </>
  },
  {
    id: "conteudo",
    title: "4. Conteudo e comunidades",
    body: <>
      <p>Voce continua responsavel pelo conteudo que envia. Ao publicar mensagens, arquivos, imagens, audio ou video, voce declara possuir as permissoes necessarias para faze-lo.</p>
      <p>Donos e moderadores de comunidades podem definir regras adicionais, moderar conteudo, limitar permissoes, expulsar ou banir membros conforme as ferramentas disponiveis no Ginga.</p>
    </>
  },
  {
    id: "voz",
    title: "5. Voz, video e transmissao",
    body: <>
      <p>Recursos em tempo real podem transportar voz, camera e compartilhamento de tela entre participantes autorizados da sala. Nao transmita material que viole direitos de terceiros ou dados que voce nao esteja autorizado a compartilhar.</p>
      <p>A qualidade desses recursos depende da rede, do dispositivo, do navegador ou aplicativo e da capacidade do servidor.</p>
    </>
  },
  {
    id: "disponibilidade",
    title: "6. Disponibilidade e alteracoes",
    body: <>
      <p>O Ginga pode receber atualizacoes, manutencoes e correcoes de seguranca. O operador busca preservar os recursos existentes, mas pode ajustar limites tecnicos quando necessario para seguranca, estabilidade ou compatibilidade.</p>
      <p>Nao existe garantia de disponibilidade ininterrupta. Falhas de Internet, infraestrutura, integracoes externas ou manutencoes podem interromper temporariamente partes do servico.</p>
    </>
  },
  {
    id: "suspensao",
    title: "7. Suspensao e encerramento",
    body: <>
      <p>Contas podem ser restringidas ou suspensas quando houver violacao destes termos, risco de seguranca, abuso da plataforma ou exigencia legal aplicavel. Sempre que razoavelmente possivel, o motivo sera apresentado ao usuario ou ao administrador responsavel.</p>
    </>
  },
  {
    id: "contato",
    title: "8. Contato e versoes futuras",
    body: <>
      <p>Estes termos podem ser atualizados para acompanhar novos recursos, requisitos legais ou mudancas operacionais. A data da versao atual aparece no topo desta pagina.</p>
      <p>Para duvidas sobre esta instancia, procure o administrador ou operador responsavel pelo servidor Ginga que voce utiliza.</p>
    </>
  }
];

const privacySections: Section[] = [
  {
    id: "dados",
    title: "1. Dados tratados",
    body: <>
      <p>Para operar o Ginga, podemos tratar dados de conta como nome exibido, nome de usuario, e-mail, <strong>data de nascimento</strong>, credenciais protegidas, configuracoes, sessoes e informacoes de seguranca.</p>
      <p>Conforme o uso, tambem podem existir mensagens, anexos, participacao em comunidades, relacoes de amizade, configuracoes de voz e dados tecnicos de diagnostico.</p>
    </>
  },
  {
    id: "nascimento",
    title: "2. Data de nascimento e idade minima",
    body: <>
      <p>A data de nascimento e solicitada no cadastro para aplicar a regra de idade minima de 16 anos e ajudar a manter o servico adequado ao publico permitido.</p>
      <p>Ela nao deve ser exibida publicamente por padrao. Contas antigas podem nao possuir esse dado ate que uma politica futura de atualizacao de cadastro seja aplicada.</p>
    </>
  },
  {
    id: "finalidades",
    title: "3. Para que usamos os dados",
    body: <>
      <ul>
        <li>criar, autenticar e proteger contas;</li>
        <li>entregar mensagens, comunidades, chamadas e demais recursos solicitados;</li>
        <li>aplicar preferencias e permissoes;</li>
        <li>detectar abuso, fraude e problemas de seguranca;</li>
        <li>diagnosticar falhas e manter a estabilidade da instancia;</li>
        <li>cumprir obrigacoes legais aplicaveis.</li>
      </ul>
    </>
  },
  {
    id: "tempo-real",
    title: "4. Voz, camera e compartilhamento",
    body: <>
      <p>Midia de voz, video e compartilhamento de tela e transmitida em tempo real para viabilizar a chamada. O funcionamento pode envolver o servidor de comunicacao em tempo real configurado pelo operador da instancia.</p>
      <p>O Ginga nao deve gravar chamadas automaticamente apenas por voce entrar em uma sala. Se uma instalacao adicionar gravacao no futuro, isso deve ser informado de maneira adequada.</p>
    </>
  },
  {
    id: "armazenamento",
    title: "5. Armazenamento, retencao e exclusao",
    body: <>
      <p>O tempo de retencao depende do tipo de dado, das configuracoes da instancia, das necessidades de seguranca e das obrigacoes legais aplicaveis. Dados podem permanecer em backups por um periodo limitado ate a rotacao normal desses backups.</p>
      <p>Quando tecnicamente e legalmente possivel, pedidos de correcao ou exclusao devem ser direcionados ao operador da instancia.</p>
    </>
  },
  {
    id: "compartilhamento",
    title: "6. Compartilhamento e fornecedores",
    body: <>
      <p>Dados podem ser processados por componentes necessarios ao funcionamento do servico, como hospedagem, banco de dados, envio de e-mail, comunicacao em tempo real e integracoes escolhidas pelo administrador.</p>
      <p>O Ginga nao precisa vender dados pessoais para funcionar. O operador deve limitar o acesso ao necessario para operacao, seguranca e suporte.</p>
    </>
  },
  {
    id: "seguranca",
    title: "7. Seguranca",
    body: <>
      <p>O projeto utiliza medidas como senhas protegidas por hash, sessoes autenticadas, verificacao em duas etapas quando habilitada, controles de permissao e protecoes de aplicacao. Nenhum sistema conectado a Internet e totalmente livre de risco.</p>
    </>
  },
  {
    id: "direitos",
    title: "8. Seus direitos e contato",
    body: <>
      <p>Dependendo da legislacao aplicavel, inclusive a LGPD no Brasil, voce pode ter direitos de confirmacao, acesso, correcao, informacao, oposicao ou exclusao de dados em determinadas situacoes.</p>
      <p>Para exercer esses direitos ou tirar duvidas, entre em contato com o administrador ou operador responsavel pela instancia Ginga que hospeda sua conta.</p>
    </>
  }
];

export function LegalPage({ kind, onExit }: LegalPageProps) {
  const isTerms = kind === "terms";
  const sections = isTerms ? termsSections : privacySections;
  const title = isTerms ? "Termos de Uso" : "Politica de Privacidade";
  const subtitle = isTerms
    ? "Regras essenciais para usar o Ginga com seguranca e responsabilidade."
    : "Como os dados sao usados para operar, proteger e melhorar sua experiencia no Ginga.";

  return (
    <main className="legal-page">
      <header className="legal-topbar">
        <button type="button" className="legal-back" onClick={onExit}><ArrowLeft size={17}/> Voltar</button>
        <a className="legal-brand" href="/" aria-label="Ginga"><img src="/ginga-mark.svg" alt=""/><strong>Ginga</strong></a>
        <a className="legal-help" href="/knowledge"><BookOpen size={15}/> Central de ajuda</a>
      </header>

      <div className="legal-shell">
        <aside className="legal-sidebar" aria-label={`Indice - ${title}`}>
          <div className="legal-sidebar-heading">{isTerms ? <FileText size={17}/> : <ShieldCheck size={17}/>}<span><small>DOCUMENTO</small><strong>{title}</strong></span></div>
          <nav>{sections.map((section) => <a href={`#${section.id}`} key={section.id}>{section.title}</a>)}</nav>
          <div className="legal-sidebar-links">
            <a className={!isTerms ? "active" : ""} href="/privacy"><LockKeyhole size={14}/> Privacidade</a>
            <a className={isTerms ? "active" : ""} href="/terms"><FileText size={14}/> Termos de Uso</a>
          </div>
        </aside>

        <section className="legal-content">
          <article className="legal-document">
            <header>
              <span className="legal-document-icon">{isTerms ? <UserRoundCheck size={25}/> : <Database size={25}/>}</span>
              <div><small>Atualizado em {UPDATED_AT}</small><h1>{title}</h1><p>{subtitle}</p></div>
            </header>
            <div className="legal-notice"><ShieldCheck size={17}/><span>Este documento se aplica ao uso desta instancia do Ginga. O administrador da instalacao continua responsavel por configurar e operar o ambiente de acordo com sua realidade.</span></div>
            {sections.map((section) => <section className="legal-section" id={section.id} key={section.id}><h2>{section.title}</h2>{section.body}</section>)}
            <footer><Mail size={16}/><span>Precisa de ajuda? Consulte o administrador da sua instancia ou a <a href="/knowledge">Central de ajuda do Ginga</a>.</span></footer>
          </article>
        </section>
      </div>
    </main>
  );
}
