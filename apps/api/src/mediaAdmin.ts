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
