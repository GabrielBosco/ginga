import { ExternalLink } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import type { GuildMember, User } from "../types";
import { gingaConfirm } from "../lib/dialogs";

const customEmojiTokenPattern = /\[\[ginga-emoji\|([^|\]]{1,32})\|([^|\]]+)\]\]/gi;
const inlineTokenPattern = /(\[\[ginga-emoji\|([^|\]]{1,32})\|([^|\]]+)\]\]|\[([^\]\n]{1,240})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)|@(?:todos|everyone|here|[a-zA-Z0-9_.-]{3,24})|`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+)\*|_([^_\n]+)_)/gi;
const fencePattern = /```(?:([a-zA-Z0-9_+-]{1,24}))?\n?([\s\S]*?)```/g;

interface MessageContentProps {
  content: string;
  username?: string;
  members?: GuildMember[];
  onUserClick?: (user: User, rect: DOMRect) => void;
}

function trimUrlPunctuation(value: string) {
  let url = value;
  let suffix = "";
  while (/[.,!?;:]$/.test(url)) {
    suffix = url.slice(-1) + suffix;
    url = url.slice(0, -1);
  }
  // Fecha parenteses apenas quando o URL possui mais ')' que '('.
  while (url.endsWith(")") && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)) {
    suffix = ")" + suffix;
    url = url.slice(0, -1);
  }
  return { url, suffix };
}

function isExternalUrl(value: string) {
  try {
    return new URL(value, window.location.origin).origin !== window.location.origin;
  } catch {
    return true;
  }
}

async function openSafeLink(event: MouseEvent<HTMLAnchorElement>, value: string) {
  event.preventDefault();
  event.stopPropagation();
  let url: URL;
  try { url = new URL(value, window.location.origin); }
  catch { return; }
  if (!/^https?:$/.test(url.protocol)) return;

  if (isExternalUrl(url.href)) {
    const accepted = await gingaConfirm(
      `Voce esta saindo do Ginga e abrindo ${url.hostname}.\n\n${url.href}\n\nAbra apenas se confiar neste destino.`,
      { title: "Abrir link externo?", confirmLabel: "Abrir link", cancelLabel: "Cancelar" }
    );
    if (!accepted) return;
  }

  window.open(url.href, "_blank", "noopener,noreferrer");
}

function linkNode(urlValue: string, label: ReactNode, key: string) {
  const { url, suffix } = trimUrlPunctuation(urlValue);
  let host = url;
  try { host = new URL(url).hostname; } catch { /* usa URL original */ }
  return <span className="message-link-wrap" key={key}>
    <a className="message-link" href={url} target="_blank" rel="noopener noreferrer" title={`Abrir ${host}`} onClick={(event) => void openSafeLink(event, url)}>{label}<ExternalLink size={11} aria-hidden="true" /></a>{suffix}
  </span>;
}

function inlineNodes(source: string, options: MessageContentProps, keyPrefix: string): ReactNode[] {
  if (!source) return [];
  const members = options.members ?? [];
  const current = (options.username ?? "").toLowerCase();
  const result: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  inlineTokenPattern.lastIndex = 0;

  for (const match of source.matchAll(inlineTokenPattern)) {
    const position = match.index ?? 0;
    if (position > cursor) result.push(source.slice(cursor, position));
    const token = match[0];
    const key = `${keyPrefix}:${index}:${position}`;

    if (token.startsWith("[[ginga-emoji|")) {
      try {
        const name = decodeURIComponent(match[2] || "emoji");
        const url = decodeURIComponent(match[3] || "");
        result.push(<img className="custom-message-emoji" src={url} alt={`:${name}:`} key={key} loading="lazy" />);
      } catch { result.push(token); }
    } else if (match[4] && match[5]) {
      result.push(linkNode(match[5], match[4], key));
    } else if (match[6]) {
      result.push(linkNode(match[6], trimUrlPunctuation(match[6]).url, key));
    } else if (token.startsWith("@")) {
      const name = token.slice(1).toLowerCase();
      const everyone = ["todos", "everyone", "here"].includes(name);
      const target = everyone ? null : members.find((member) => member.user.username.toLowerCase() === name)?.user ?? null;
      const className = `message-mention ${everyone ? "everyone" : ""} ${name === current || everyone ? "mine" : ""}`;
      if (target && options.onUserClick) {
        result.push(<button type="button" className={`${className} clickable`} key={key} title={`Abrir perfil de ${target.displayName}`} onClick={(event) => { event.stopPropagation(); options.onUserClick?.(target, event.currentTarget.getBoundingClientRect()); }}>{token}</button>);
      } else if (target || everyone) result.push(<span className={className} key={key}>{everyone ? "@todos" : token}</span>);
      else result.push(token);
    } else if (match[7]) result.push(<code className="message-inline-code" key={key}>{match[7]}</code>);
    else if (match[8]) result.push(<strong className="message-bold" key={key}>{match[8]}</strong>);
    else if (match[9]) result.push(<u className="message-underline" key={key}>{match[9]}</u>);
    else if (match[10]) result.push(<s className="message-strike" key={key}>{match[10]}</s>);
    else if (match[11]) result.push(<em className="message-italic" key={key}>{match[11]}</em>);
    else if (match[12]) result.push(<em className="message-italic" key={key}>{match[12]}</em>);
    else result.push(token);

    cursor = position + token.length;
    index += 1;
  }
  if (cursor < source.length) result.push(source.slice(cursor));
  return result;
}

function renderTextBlock(source: string, options: MessageContentProps, keyPrefix: string) {
  const lines = source.split("\n");
  return lines.flatMap((line, lineIndex) => {
    const content = inlineNodes(line, options, `${keyPrefix}:line:${lineIndex}`);
    return lineIndex < lines.length - 1 ? [...content, <br key={`${keyPrefix}:br:${lineIndex}`} />] : content;
  });
}

export function MessageContent(props: MessageContentProps) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let block = 0;
  fencePattern.lastIndex = 0;

  for (const match of props.content.matchAll(fencePattern)) {
    const position = match.index ?? 0;
    if (position > cursor) nodes.push(...renderTextBlock(props.content.slice(cursor, position), props, `text:${block}`));
    nodes.push(<pre className="message-code-block" key={`code:${block}`}><code data-language={match[1] || undefined}>{match[2].replace(/^\n|\n$/g, "")}</code></pre>);
    cursor = position + match[0].length;
    block += 1;
  }
  if (cursor < props.content.length) nodes.push(...renderTextBlock(props.content.slice(cursor), props, `text:${block}`));
  return <>{nodes}</>;
}

export function contentHasCustomEmojiUrl(content: string, url: string) {
  customEmojiTokenPattern.lastIndex = 0;
  for (const match of content.matchAll(customEmojiTokenPattern)) {
    try { if (decodeURIComponent(match[2]) === url) return true; } catch { /* token invalido */ }
  }
  return false;
}
