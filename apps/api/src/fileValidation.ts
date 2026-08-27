import { open } from "node:fs/promises";
import { HttpError } from "./errors.js";

const MAX_SIGNATURE_BYTES = 64 * 1024;

function startsWith(buffer: Buffer, bytes: number[], offset = 0) {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function ascii(buffer: Buffer, start: number, length: number) {
  return buffer.subarray(start, Math.min(buffer.length, start + length)).toString("ascii");
}

function containsAscii(buffer: Buffer, value: string, start = 0, end = 64) {
  const slice = buffer.subarray(start, Math.min(buffer.length, end));
  return slice.includes(Buffer.from(value, "ascii"));
}

function looksLikeIsoBmff(buffer: Buffer) {
  return ascii(buffer, 4, 4) === "ftyp" || containsAscii(buffer, "ftyp", 0, 64);
}

function looksLikeText(buffer: Buffer) {
  if (buffer.length === 0) return true;
  if (buffer.includes(0x00)) return false;

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

function signatureMatches(mimeType: string, buffer: Buffer) {
  switch (mimeType) {
    case "image/jpeg":
      return startsWith(buffer, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/gif": {
      const header = ascii(buffer, 0, 6);
      return header === "GIF87a" || header === "GIF89a";
    }
    case "image/webp":
      return ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 4) === "WEBP";
    case "image/avif":
      return looksLikeIsoBmff(buffer) && (containsAscii(buffer, "avif", 8, 48) || containsAscii(buffer, "avis", 8, 48));
    case "video/mp4":
      return looksLikeIsoBmff(buffer) && !containsAscii(buffer, "avif", 8, 48);
    case "video/quicktime":
      return looksLikeIsoBmff(buffer) || ascii(buffer, 4, 4) === "moov" || ascii(buffer, 4, 4) === "wide";
    case "video/webm":
    case "audio/webm":
      return startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3]);
    case "audio/mpeg":
      return ascii(buffer, 0, 3) === "ID3" || (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0);
    case "audio/ogg":
      return ascii(buffer, 0, 4) === "OggS";
    case "audio/wav":
      return ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 4) === "WAVE";
    case "audio/mp4":
      return looksLikeIsoBmff(buffer);
    case "audio/aac":
      return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1]! & 0xf6) === 0xf0;
    case "audio/flac":
      return ascii(buffer, 0, 4) === "fLaC";
    case "application/pdf":
      return ascii(buffer, 0, 5) === "%PDF-";
    case "application/zip":
      return startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])
        || startsWith(buffer, [0x50, 0x4b, 0x05, 0x06])
        || startsWith(buffer, [0x50, 0x4b, 0x07, 0x08]);
    case "application/x-7z-compressed":
      return startsWith(buffer, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
    case "application/vnd.rar":
    case "application/x-rar-compressed":
      return startsWith(buffer, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])
        || startsWith(buffer, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
    case "text/plain":
      return looksLikeText(buffer);
    default:
      return false;
  }
}

/**
 * Segunda camada de validacao do upload.
 * MIME e extensao enviados pelo cliente nao sao confiaveis; aqui validamos
 * a assinatura real do arquivo antes de persistir o registro no banco.
 */
export async function assertUploadedFileSignature(filePath: string, mimeType: string) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(MAX_SIGNATURE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, bytesRead);
    if (!signatureMatches(mimeType, sample)) {
      throw new HttpError(415, "O conteudo do arquivo nao corresponde ao tipo informado");
    }
  } finally {
    await handle.close();
  }
}
