export type PreparedImageAsset = {
  blob: Blob;
  mime: "image/webp" | "image/gif";
  animated: boolean;
};

const STATIC_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

function isStaticImageType(type: string) {
  return (STATIC_IMAGE_TYPES as readonly string[]).includes(type);
}

async function readImageDimensions(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Nao foi possivel ler esta imagem."));
      element.src = objectUrl;
    });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function validateAnimatedGif(file: File, maxBytes: number, minimumSide = 32) {
  if (file.type !== "image/gif") throw new Error("Selecione uma imagem PNG, JPG, WebP ou GIF.");
  if (file.size > maxBytes) throw new Error(`O GIF pode ter no maximo ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const { width, height } = await readImageDimensions(file);
  if (Math.min(width, height) < minimumSide) throw new Error("A imagem e pequena demais.");
  if (width > 8192 || height > 8192 || width * height > 40_000_000) throw new Error("A imagem tem resolucao grande demais. Use ate 8192x8192.");
}

export async function imageFileToSquareWebp(file: File, size = 512, quality = 0.88): Promise<Blob> {
  if (!isStaticImageType(file.type)) throw new Error("Selecione uma imagem PNG, JPG ou WebP.");
  if (file.size > 8 * 1024 * 1024) throw new Error("A imagem original pode ter no maximo 8 MB.");

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Nao foi possivel ler esta imagem."));
      element.src = objectUrl;
    });

    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
    if (sourceSize < 32) throw new Error("A imagem e pequena demais.");
    const sx = Math.max(0, (image.naturalWidth - sourceSize) / 2);
    const sy = Math.max(0, (image.naturalHeight - sourceSize) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Seu navegador nao conseguiu processar a imagem.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    if (!blob) throw new Error("Nao foi possivel converter a imagem para WebP.");
    if (blob.size > 1024 * 1024) throw new Error("A imagem processada ficou acima de 1 MB. Tente outra imagem.");
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function imageFileToWideWebp(file: File, width = 1600, height = 600, quality = 0.88): Promise<Blob> {
  if (!isStaticImageType(file.type)) throw new Error("Selecione uma imagem PNG, JPG ou WebP.");
  if (file.size > 12 * 1024 * 1024) throw new Error("A imagem original pode ter no maximo 12 MB.");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error("Nao foi possivel ler esta imagem.")); element.src = objectUrl; });
    const targetRatio = width / height, sourceRatio = image.naturalWidth / image.naturalHeight;
    let sx=0,sy=0,sw=image.naturalWidth,sh=image.naturalHeight;
    if(sourceRatio>targetRatio){sw=image.naturalHeight*targetRatio;sx=(image.naturalWidth-sw)/2}else{sh=image.naturalWidth/targetRatio;sy=(image.naturalHeight-sh)/2}
    const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const context=canvas.getContext("2d",{alpha:false});if(!context)throw new Error("Seu navegador nao conseguiu processar a imagem.");context.imageSmoothingEnabled=true;context.imageSmoothingQuality="high";context.drawImage(image,sx,sy,sw,sh,0,0,width,height);
    const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/webp",quality));if(!blob)throw new Error("Nao foi possivel converter a imagem para WebP.");if(blob.size>2*1024*1024)throw new Error("A imagem processada ficou acima de 2 MB.");return blob;
  } finally { URL.revokeObjectURL(objectUrl); }
}

/**
 * Mantem GIF animado no formato original. Imagens estaticas continuam passando
 * pelo pipeline WebP para economizar banda e armazenamento.
 */
export async function prepareSquareImageAsset(file: File, size = 512, quality = 0.88): Promise<PreparedImageAsset> {
  if (file.type === "image/gif") {
    await validateAnimatedGif(file, 8 * 1024 * 1024);
    return { blob: file, mime: "image/gif", animated: true };
  }
  const blob = await imageFileToSquareWebp(file, size, quality);
  return { blob, mime: "image/webp", animated: false };
}

/**
 * Banners GIF sao enviados sem canvas para nao destruir os frames da animacao.
 */
export async function prepareWideImageAsset(file: File, width = 1600, height = 600, quality = 0.88): Promise<PreparedImageAsset> {
  if (file.type === "image/gif") {
    await validateAnimatedGif(file, 12 * 1024 * 1024);
    return { blob: file, mime: "image/gif", animated: true };
  }
  const blob = await imageFileToWideWebp(file, width, height, quality);
  return { blob, mime: "image/webp", animated: false };
}
