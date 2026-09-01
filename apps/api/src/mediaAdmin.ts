import { RoomServiceClient } from "livekit-server-sdk";
import { config } from "./config.js";

const rooms = new RoomServiceClient(config.LIVEKIT_INTERNAL_URL, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);

export async function removeUserFromGuildMedia(guildId: string, userId: string) {
  try {
    const activeRooms = await rooms.listRooms();
    const guildPrefix = `space-${guildId}-voice-`;
    const matching = activeRooms.filter((room) => room.name.startsWith(guildPrefix));
    await Promise.allSettled(matching.map((room) => rooms.removeParticipant(room.name, userId)));
  } catch (error) {
    // Moderacao no banco continua valida mesmo se a sala ja tiver encerrado ou o SFU estiver indisponivel.
    console.warn("Nao foi possivel remover participante das salas LiveKit", error);
  }
}


export async function setUserGuildMediaPermissions(
  guildId: string,
  userId: string,
  permissions: { canPublish: boolean; canSubscribe: boolean }
) {
  try {
    const activeRooms = await rooms.listRooms();
    const guildPrefix = `space-${guildId}-voice-`;
    const matching = activeRooms.filter((room) => room.name.startsWith(guildPrefix));
    await Promise.allSettled(matching.map((room) => rooms.updateParticipant(room.name, userId, {
      permission: {
        canPublish: permissions.canPublish,
        canSubscribe: permissions.canSubscribe,
        canPublishData: true
      }
    })));
  } catch (error) {
    // O estado no banco/Socket.IO continua sendo a fonte de verdade. O cliente
    // tambem aplica o mute imediatamente; esta chamada endurece a restricao no SFU.
    console.warn("Nao foi possivel atualizar permissoes do participante no LiveKit", error);
  }
}
