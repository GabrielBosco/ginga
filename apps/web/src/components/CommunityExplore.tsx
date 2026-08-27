import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowRight, BookOpen, Check, Compass, Globe2, LoaderCircle, Search, Sparkles, Users, Wifi, X } from "lucide-react";
import { api } from "../lib/api";
import type { CommunityGuild } from "../types";

interface CommunityExploreProps {
  onOpenGuild: (guildId: string) => Promise<void> | void;
  onJoined: (guildId: string, welcomeChannelId?: string | null) => Promise<void> | void;
}

export function CommunityExplore({ onOpenGuild, onJoined }: CommunityExploreProps) {
  const [communities, setCommunities] = useState<CommunityGuild[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState("");
  const [error, setError] = useState("");
  const [rulesGuild, setRulesGuild] = useState<CommunityGuild | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (category) params.set("category", category);
      const suffix = params.size ? `?${params.toString()}` : "";
      const result = await api<{ communities: CommunityGuild[]; categories: string[] }>(`/api/communities${suffix}`);
      setCommunities(result.communities);
      setCategories(result.categories);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel carregar as comunidades");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, query ? 260 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, category]);

  const featured = useMemo(
    () => communities.slice().sort((a, b) => b.memberCount - a.memberCount)[0] ?? null,
    [communities],
  );
  const isBrowsingAll = !query.trim() && !category;
  const visibleCommunities = useMemo(
    () => isBrowsingAll && featured ? communities.filter((guild) => guild.id !== featured.id) : communities,
    [communities, featured, isBrowsingAll],
  );
  const totals = useMemo(
    () => communities.reduce((acc, guild) => ({ members: acc.members + guild.memberCount, online: acc.online + guild.onlineCount }), { members: 0, online: 0 }),
    [communities],
  );

  async function join(guild: CommunityGuild) {
    if (guild.joined) return void onOpenGuild(guild.id);
    setJoining(guild.id);
    setError("");
    try {
      const result = await api<{ guildId: string; welcomeChannelId?: string | null }>(`/api/communities/${encodeURIComponent(guild.id)}/join`, { method: "POST" });
      setCommunities((current) => current.map((item) => item.id === guild.id ? { ...item, joined: true, memberCount: item.memberCount + 1 } : item));
      await onJoined(guild.id, result.welcomeChannelId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel entrar nesta comunidade");
    } finally {
      setJoining("");
    }
  }

  return (
    <section className="community-explore community-explore-v2">
      <header className="community-discovery-header-v2">
        <div className="community-discovery-heading-v2">
          <span className="community-discovery-kicker"><Compass size={15}/> DESCOBRIR</span>
          <h1>Servidores da comunidade</h1>
          <p>Encontre um lugar para jogar, estudar, criar projetos ou simplesmente trocar ideia.</p>
        </div>
        <div className="community-discovery-summary-v2" aria-label="Resumo das comunidades encontradas">
          <span><Globe2 size={15}/><b>{communities.length}</b><small>servidores</small></span>
          <span><Users size={15}/><b>{totals.members.toLocaleString("pt-BR")}</b><small>membros</small></span>
          <span><Wifi size={15}/><b>{totals.online.toLocaleString("pt-BR")}</b><small>online</small></span>
        </div>
      </header>

      <div className="community-discovery-tools-v2">
        <label className="community-explore-search community-explore-search-v2">
          <Search size={18}/>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar servidor, descricao ou tag..." />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Limpar busca"><X size={15}/></button>}
        </label>
        <nav className="community-category-row community-category-row-v2" aria-label="Categorias de comunidades">
          <button className={!category ? "active" : ""} onClick={() => setCategory("")}>Todos</button>
          {categories.map((item) => <button className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}
        </nav>
      </div>

      {error && <div className="community-error-v2"><span>{error}</span><button type="button" onClick={() => void load()}>Tentar novamente</button></div>}

      {loading && <div className="community-skeleton-grid" aria-label="Carregando comunidades">{Array.from({ length: 6 }).map((_, index) => <div className="community-skeleton-card" key={index}><i/><b/><span/><span/></div>)}</div>}

      {!loading && featured && isBrowsingAll && (
        <section className="community-featured-section-v2">
          <div className="community-section-title-v2"><div><Sparkles size={16}/><span><strong>Em destaque</strong><small>Comunidade com mais membros agora</small></span></div></div>
          <article className="community-featured-card community-featured-card-v2">
            <div className="community-featured-glow" style={{ "--community-color": featured.iconColor } as CSSProperties}/>
            {featured.bannerUrl ? <img className="community-featured-banner" src={featured.bannerUrl} alt=""/> : <div className="community-featured-banner-fallback" style={{ "--community-color": featured.iconColor } as CSSProperties}/>} 
            <div className="community-featured-overlay-v2"/>
            <div className={`community-icon xl ${featured.iconUrl ? "with-image" : ""}`} style={{ background: featured.iconColor }}>{featured.iconUrl ? <img src={featured.iconUrl} alt=""/> : featured.name.slice(0, 1).toUpperCase()}</div>
            <div className="community-featured-copy">
              <span><Sparkles size={14}/> DESTAQUE DA COMUNIDADE</span>
              <h2>{featured.name}</h2>
              <p>{featured.description || "Uma comunidade publica no Ginga."}</p>
              <div className="community-tags community-featured-tags-v2">{featured.communityTags.slice(0, 5).map((tag) => <span key={tag}>#{tag}</span>)}</div>
              <div className="community-stats"><span><Users size={14}/>{featured.memberCount.toLocaleString("pt-BR")} membros</span><span className="online"><i/>{featured.onlineCount.toLocaleString("pt-BR")} online</span></div>
            </div>
            <div className="community-featured-actions-v2">
              {featured.rules?.trim() && <button type="button" className="secondary-button" onClick={() => setRulesGuild(featured)}><BookOpen size={15}/> Regras</button>}
              <button className={featured.joined ? "secondary-button" : "primary-button"} disabled={joining === featured.id} onClick={() => void join(featured)}>{joining === featured.id ? <LoaderCircle className="spin" size={16}/> : featured.joined ? <Check size={16}/> : <ArrowRight size={16}/>} {featured.joined ? "Abrir servidor" : "Entrar agora"}</button>
            </div>
          </article>
        </section>
      )}

      {!loading && visibleCommunities.length > 0 && (
        <section className="community-list-section-v2">
          <div className="community-section-title-v2"><div><Compass size={16}/><span><strong>{query || category ? "Resultados" : "Mais comunidades"}</strong><small>{visibleCommunities.length} {visibleCommunities.length === 1 ? "servidor encontrado" : "servidores encontrados"}</small></span></div></div>
          <div className="community-card-grid community-card-grid-v2">
            {visibleCommunities.map((guild) => (
              <article className="community-card community-card-v2" key={guild.id}>
                <div className="community-card-cover-v2">
                  {guild.bannerUrl ? <img src={guild.bannerUrl} alt=""/> : <span style={{ "--community-color": guild.iconColor } as CSSProperties}/>} 
                  <span className="community-card-cover-shade-v2"/>
                </div>
                <div className="community-card-body-v2">
                  <div className="community-card-identity-v2">
                    <div className={`community-icon ${guild.iconUrl ? "with-image" : ""}`} style={{ background: guild.iconColor }}>{guild.iconUrl ? <img src={guild.iconUrl} alt=""/> : guild.name.slice(0, 1).toUpperCase()}</div>
                    <div className="community-card-title-v2"><div><h3>{guild.name}</h3>{guild.joined && <span className="community-joined-badge-v2"><Check size={11}/> Participando</span>}</div><span>{guild.communityCategory || "Comunidade"}</span></div>
                  </div>
                  <p>{guild.description || "Esta comunidade ainda nao adicionou uma descricao."}</p>
                  {guild.communityTags.length > 0 && <div className="community-tags community-card-tags-v2">{guild.communityTags.slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}</div>}
                </div>
                <footer className="community-card-footer community-card-footer-v2">
                  <div className="community-stats"><span><Users size={13}/>{guild.memberCount.toLocaleString("pt-BR")}</span><span className="online"><i/>{guild.onlineCount.toLocaleString("pt-BR")} online</span></div>
                  <div className="community-card-actions-v2">
                    {guild.rules?.trim() && <button type="button" className="community-rules-button" onClick={() => setRulesGuild(guild)} aria-label={`Ver regras de ${guild.name}`}><BookOpen size={14}/></button>}
                    <button className={guild.joined ? "secondary-button compact-button" : "primary-button compact-button"} disabled={joining === guild.id} onClick={() => void join(guild)}>{joining === guild.id ? <LoaderCircle className="spin" size={14}/> : guild.joined ? "Abrir" : "Entrar"}</button>
                  </div>
                </footer>
              </article>
            ))}
          </div>
        </section>
      )}

      {!loading && communities.length === 0 && <div className="community-empty community-empty-v2"><Compass size={34}/><strong>Nenhuma comunidade encontrada</strong><span>Tente outro termo ou escolha outra categoria.</span>{(query || category) && <button type="button" className="secondary-button" onClick={() => { setQuery(""); setCategory(""); }}>Limpar filtros</button>}</div>}

      {rulesGuild && <div className="community-rules-backdrop" onMouseDown={() => setRulesGuild(null)}><section className="community-rules-dialog" onMouseDown={(event) => event.stopPropagation()}><header><div><BookOpen size={20}/><strong>Regras de {rulesGuild.name}</strong></div><button type="button" onClick={() => setRulesGuild(null)}><X size={17}/></button></header><div className="community-rules-content"><pre>{rulesGuild.rules}</pre></div><footer><button type="button" className="secondary-button" onClick={() => setRulesGuild(null)}>Fechar</button></footer></section></div>}
    </section>
  );
}
