import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Link2, LoaderCircle, Search, SlidersHorizontal } from "lucide-react";
import { api } from "../lib/api";
import type { ChatMessage, Guild, GuildMember } from "../types";
import { Avatar } from "./Avatar";
import { Modal } from "./Modal";

type SearchResult = ChatMessage & {
  channel: { id: string; name: string; type: string; guildId: string };
};

interface GlobalSearchProps {
  guild: Guild;
  members: GuildMember[];
  onClose: () => void;
  onOpenMessage: (channelId: string, messageId: string) => void;
}

function endOfDayIso(value: string) {
  if (!value) return "";
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function startOfDayIso(value: string) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00.000`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function GlobalSearch({ guild, members, onClose, onOpenMessage }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [channelId, setChannelId] = useState("");
  const [authorId, setAuthorId] = useState("");
  const [has, setHas] = useState<"" | "attachments" | "links">("");
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestRevision = useRef(0);

  const textChannels = useMemo(
    () => guild.channels.filter((channel) => ["TEXT", "ANNOUNCEMENT"].includes(channel.type)),
    [guild.channels]
  );
  const searchableMembers = useMemo(
    () => [...members].sort((a, b) => (a.nickname || a.user.displayName).localeCompare(b.nickname || b.user.displayName, "pt-BR")),
    [members]
  );

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setResults([]);
      setLoading(false);
      setError("");
      return;
    }
    const revision = ++requestRevision.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({ q: needle, limit: "80" });
      if (channelId) params.set("channelId", channelId);
      if (authorId) params.set("authorId", authorId);
      if (has) params.set("has", has);
      const afterIso = startOfDayIso(after);
      const beforeIso = endOfDayIso(before);
      if (afterIso) params.set("after", afterIso);
      if (beforeIso) params.set("before", beforeIso);
      try {
        const response = await api<{ messages: SearchResult[] }>(`/api/guilds/${encodeURIComponent(guild.id)}/search?${params.toString()}`);
        if (revision === requestRevision.current) setResults(response.messages);
      } catch (caught) {
        if (revision === requestRevision.current) {
          setResults([]);
          setError(caught instanceof Error ? caught.message : "Nao foi possivel pesquisar as mensagens.");
        }
      } finally {
        if (revision === requestRevision.current) setLoading(false);
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [after, authorId, before, channelId, guild.id, has, query]);

  const filtersActive = Boolean(channelId || authorId || has || after || before);

  return (
    <Modal title={`Buscar em ${guild.name}`} onClose={onClose} width="lg">
      <div className="global-search-v3">
        <label className="global-search-input-v3">
          <Search size={18}/>
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Mensagem, pessoa ou nome de arquivo..." maxLength={100}/>
          {loading ? <LoaderCircle className="spin" size={17}/> : <kbd>Ctrl Shift F</kbd>}
        </label>

        <div className="global-search-filters-v3">
          <label><span>Canal</span><select value={channelId} onChange={(event)=>setChannelId(event.target.value)}><option value="">Todos os canais</option>{textChannels.map(channel=><option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select></label>
          <label><span>Autor</span><select value={authorId} onChange={(event)=>setAuthorId(event.target.value)}><option value="">Qualquer pessoa</option>{searchableMembers.map(member=><option key={member.user.id} value={member.user.id}>{member.nickname || member.user.displayName} (@{member.user.username})</option>)}</select></label>
          <label><span>Conteudo</span><select value={has} onChange={(event)=>setHas(event.target.value as ""|"attachments"|"links")}><option value="">Qualquer conteudo</option><option value="attachments">Com anexos</option><option value="links">Com links</option></select></label>
          <label><span>Depois de</span><input type="date" value={after} onChange={(event)=>setAfter(event.target.value)}/></label>
          <label><span>Antes de</span><input type="date" value={before} onChange={(event)=>setBefore(event.target.value)}/></label>
          {filtersActive && <button type="button" className="secondary-button compact-button" onClick={()=>{setChannelId("");setAuthorId("");setHas("");setAfter("");setBefore("");}}><SlidersHorizontal size={14}/> Limpar filtros</button>}
        </div>

        {error && <div className="inline-alert danger">{error}</div>}
        {query.trim().length < 2 && <div className="global-search-empty-v3"><Search size={30}/><strong>Pesquisa em todo o servidor</strong><span>Digite pelo menos 2 caracteres. Voce pode combinar canal, autor, anexos, links e periodo.</span></div>}
        {query.trim().length >= 2 && !loading && !error && results.length === 0 && <div className="global-search-empty-v3"><Search size={30}/><strong>Nenhum resultado</strong><span>Nao encontramos mensagens visiveis para estes filtros.</span></div>}

        {results.length > 0 && <div className="global-search-results-v3">
          <header><span>{results.length} resultado{results.length===1?"":"s"}</span><small>A pesquisa respeita as permissoes dos canais.</small></header>
          {results.map((message)=><button type="button" key={message.id} onClick={()=>onOpenMessage(message.channelId,message.id)}>
            <Avatar user={message.author} size="sm"/>
            <div>
              <div className="global-search-result-meta-v3"><strong>{message.author.displayName}</strong><span>#{message.channel.name}</span><time>{new Date(message.createdAt).toLocaleString("pt-BR")}</time></div>
              <p>{message.content?.slice(0,320) || message.attachments[0]?.originalName || "Mensagem com anexo"}</p>
              {message.attachments.length>0&&<small><FileText size={12}/>{message.attachments.length} anexo{message.attachments.length===1?"":"s"}</small>}
              {/https?:\/\//i.test(message.content||"")&&<small><Link2 size={12}/> contem link</small>}
            </div>
          </button>)}
        </div>}
      </div>
    </Modal>
  );
}
