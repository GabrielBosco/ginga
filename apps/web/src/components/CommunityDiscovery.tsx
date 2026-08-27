import { useEffect, useMemo, useState } from "react";
import { Check, Compass, LoaderCircle, Search, Sparkles, Users } from "lucide-react";
import { api } from "../lib/api";
import type { CommunityGuild } from "../types";

interface CommunityDiscoveryProps {
  onJoined: (guildId: string) => Promise<void> | void;
}

export function CommunityDiscovery({ onJoined }: CommunityDiscoveryProps) {
  const [communities, setCommunities] = useState<CommunityGuild[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (category) params.set("category", category);
      setLoading(true);
      setError("");
      api<{ communities: CommunityGuild[]; categories: string[] }>(`/api/communities${params.size ? `?${params.toString()}` : ""}`)
        .then((result) => {
          if (!active) return;
          setCommunities(result.communities);
          setCategories(result.categories);
        })
        .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Nao foi possivel carregar as comunidades"); })
        .finally(() => { if (active) setLoading(false); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [category, query]);

  const featured = useMemo(() => communities.slice(0, 3), [communities]);

  async function join(community: CommunityGuild) {
    if (community.joined || joiningId) return;
    setJoiningId(community.id);
    setError("");
    try {
      await api(`/api/communities/${encodeURIComponent(community.id)}/join`, { method: "POST" });
      setCommunities((current) => current.map((item) => item.id === community.id ? { ...item, joined: true, memberCount: item.memberCount + 1 } : item));
      await onJoined(community.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nao foi possivel entrar nesta comunidade");
    } finally {
      setJoiningId("");
    }
  }

  return (
    <section className="community-discovery">
      <header className="community-discovery-hero">
        <div className="community-discovery-icon"><Compass size={30}/></div>
        <div><span>DESCOBRIR</span><h1>Comunidades do Ginga</h1><p>Encontre servidores publicos para jogos, estudos, tecnologia, amigos e muito mais.</p></div>
      </header>

      <div className="community-discovery-toolbar">
        <label className="community-search"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar comunidades, descricao ou tag..." /></label>
        <div className="community-category-filter">
          <button type="button" className={!category ? "active" : ""} onClick={() => setCategory("")}>Todas</button>
          {categories.map((item) => <button type="button" className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}
      {loading && <div className="community-loading"><LoaderCircle className="spin"/> Procurando comunidades...</div>}

      {!loading && communities.length === 0 && <div className="community-empty"><Sparkles size={28}/><strong>Nenhuma comunidade encontrada</strong><span>Tente outro termo ou remova o filtro.</span></div>}

      {!loading && communities.length > 0 && (
        <div className="community-grid">
          {communities.map((community) => (
            <article className={`community-card ${featured.some((item) => item.id === community.id) ? "featured" : ""}`} key={community.id}>
              <div className="community-card-banner" style={{ background: `linear-gradient(135deg, ${community.iconColor}55, rgba(124,115,255,.10))` }} />
              <div className="community-card-head">
                <span className={`community-card-icon ${community.iconUrl ? "with-image" : ""}`} style={{ background: community.iconColor }}>{community.iconUrl ? <img src={community.iconUrl} alt=""/> : community.name.slice(0,1).toUpperCase()}</span>
                <div><strong>{community.name}</strong><span>{community.communityCategory || "Comunidade"}</span></div>
              </div>
              <p>{community.description || "Uma comunidade publica no Ginga."}</p>
              {community.communityTags.length > 0 && <div className="community-tags">{community.communityTags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
              <footer><span><Users size={15}/>{community.memberCount.toLocaleString("pt-BR")} membros</span><button type="button" className={community.joined ? "secondary-button" : "primary-button"} disabled={community.joined || joiningId === community.id} onClick={() => void join(community)}>{community.joined ? <><Check size={15}/> Participando</> : joiningId === community.id ? "Entrando..." : "Entrar"}</button></footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
