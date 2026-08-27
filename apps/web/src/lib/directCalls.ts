import { startRinging, stopRinging } from "./sounds";

export type DirectCallState = "RINGING" | "ACTIVE" | "DECLINED" | "MISSED" | "ENDED" | "CANCELLED";
export type DirectCallParticipantState = "INVITED" | "JOINED" | "LEFT" | "DECLINED" | "MISSED";

export type DirectCallParticipant = {
  userId: string;
  status: DirectCallParticipantState;
  invitedBy: string | null;
  joinedAt: string | null;
  leftAt: string | null;
  user: { id: string; username: string; displayName: string; avatarColor: string } | null;
};

export type DirectCall = {
  id: string;
  state: DirectCallState;
  callerId: string;
  calleeId: string;
  conversationId: string | null;
  roomKey: string;
  peerUserId: string;
  direction: "OUTGOING" | "INCOMING";
  membershipStatus: DirectCallParticipantState | null;
  canJoin: boolean;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  peer: { id: string; username: string; displayName: string; avatarColor: string } | null;
  participants: DirectCallParticipant[];
};

type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export type CallsBridge = {
  start(peerUserId: string): Promise<DirectCall>;
  answer(callId: string): Promise<DirectCall>;
  decline(callId: string): Promise<DirectCall>;
  end(callId: string): Promise<DirectCall>;
  join(callId: string): Promise<DirectCall>;
  leave(callId: string): Promise<DirectCall>;
  invite(callId: string, userId: string): Promise<DirectCall>;
  refresh(): Promise<DirectCall[]>;
  snapshot(): DirectCall[];
};

type GingaCallsWindow = Window & {
  gingaDirectCalls?: CallsBridge;
  __gingaDirectCallsInstalled?: boolean;
};

const ACTIVE_POLL_MS = 3500;
const BACKGROUND_POLL_MS = 12_000;

function scopedWindow() {
  return window as GingaCallsWindow;
}

export function getDirectCallsBridge(): CallsBridge | null {
  if (typeof window === "undefined") return null;
  return scopedWindow().gingaDirectCalls ?? null;
}

function dispatchCalls(calls: DirectCall[]) {
  window.dispatchEvent(new CustomEvent("ginga:direct-calls:update", { detail: { calls } }));
}

export function installDirectCallExperience(api: ApiRequest, isAuthenticated: () => boolean = () => true) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const scoped = scopedWindow();
  if (scoped.__gingaDirectCallsInstalled) return;
  scoped.__gingaDirectCallsInstalled = true;

  let activeCalls: DirectCall[] = [];
  let refreshBusy: Promise<DirectCall[]> | null = null;
  let ringingIds = new Set<string>();

  function syncRinging() {
    const incoming = activeCalls.filter((call) => call.membershipStatus === "INVITED" && (call.state === "RINGING" || call.state === "ACTIVE"));
    const nextIds = new Set(incoming.map((call) => call.id));
    ringingIds = nextIds;
    if (incoming.length) startRinging();
    else {
      stopRinging();
    }
  }

  async function refresh() {
    if (!isAuthenticated()) { if (activeCalls.length || ringingIds.size) { activeCalls=[];ringingIds.clear();stopRinging();dispatchCalls([]); } return activeCalls; }
    if (refreshBusy) return refreshBusy;
    refreshBusy = api<{ calls: DirectCall[] }>("/api/direct-calls/active")
      .then((result) => {
        activeCalls = result.calls;
        syncRinging();
        dispatchCalls(activeCalls);
        return activeCalls;
      })
      .catch(() => {
        // A API pode ainda nao estar pronta durante login/bootstrap. Nao derruba a interface.
        return activeCalls;
      })
      .finally(() => { refreshBusy = null; });
    return refreshBusy;
  }

  async function mutate(path: string, init: RequestInit = {}) {
    const result = await api<{ call: DirectCall }>(path, init);
    await refresh();
    return result.call;
  }

  const bridge: CallsBridge = {
    async start(peerUserId) {
      return mutate("/api/direct-calls/start", { method: "POST", body: JSON.stringify({ peerUserId }) });
    },
    async answer(callId) {
      const call = await mutate(`/api/direct-calls/${encodeURIComponent(callId)}/answer`, { method: "POST" });
      stopRinging();
      return call;
    },
    async decline(callId) {
      const call = await mutate(`/api/direct-calls/${encodeURIComponent(callId)}/decline`, { method: "POST" });
      stopRinging();
      return call;
    },
    async end(callId) {
      const call = await mutate(`/api/direct-calls/${encodeURIComponent(callId)}/end`, { method: "POST" });
      stopRinging();
      return call;
    },
    async join(callId) {
      const call = await mutate(`/api/direct-calls/${encodeURIComponent(callId)}/join`, { method: "POST" });
      stopRinging();
      return call;
    },
    async leave(callId) {
      const call = await mutate(`/api/direct-calls/${encodeURIComponent(callId)}/leave`, { method: "POST" });
      return call;
    },
    async invite(callId, userId) {
      const result = await api<{ call: DirectCall }>(`/api/direct-calls/${encodeURIComponent(callId)}/invite`, {
        method: "POST",
        body: JSON.stringify({ userId })
      });
      await refresh();
      return result.call;
    },
    refresh,
    snapshot: () => [...activeCalls]
  };

  scoped.gingaDirectCalls = bridge;

  window.addEventListener("ginga:session-changed", ((event: Event) => {
    const authenticated = Boolean((event as CustomEvent<{ authenticated?: boolean }>).detail?.authenticated);
    if (!authenticated) {
      activeCalls = [];
      ringingIds.clear();
      stopRinging();
      dispatchCalls([]);
      return;
    }
    void refresh();
  }) as EventListener);

  window.addEventListener("ginga:direct-call-start", ((event: Event) => {
    const peerUserId = (event as CustomEvent<{ peerUserId?: string }>).detail?.peerUserId;
    if (peerUserId) void bridge.start(peerUserId).catch(() => undefined);
  }) as EventListener);

  let pollTimer=0;
  const schedule=()=>{window.clearTimeout(pollTimer);pollTimer=window.setTimeout(async()=>{if(isAuthenticated())await refresh();schedule();},document.hidden?BACKGROUND_POLL_MS:ACTIVE_POLL_MS);};
  const refreshNow=()=>{if(isAuthenticated())void refresh();schedule();};
  window.addEventListener("focus",refreshNow);window.addEventListener("online",refreshNow);document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshNow();else schedule();});
  if(isAuthenticated())void refresh();schedule();
}
