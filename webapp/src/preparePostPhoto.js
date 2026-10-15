export const MAX_POST_PHOTOS = 10;
export function postRequestId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function preparePostPhoto(file) {
  if (file.size > 30 * 1024 * 1024)
    throw new Error("Фото должно быть не больше 30 МБ до обработки");
  if (!file.type.startsWith("image/")) throw new Error("Выберите изображение");
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () =>
        reject(
          new Error(
            "Не удалось прочитать фото. Сохраните его как JPEG или PNG.",
          ),
        );
      image.src = url;
    });
    let scale = Math.min(
        1,
        1920 / Math.max(image.naturalWidth, image.naturalHeight),
      ),
      quality = 0.88;
    const canvas = document.createElement("canvas");
    for (let attempt = 0; attempt < 16; attempt++) {
      const w = Math.max(1, Math.round(image.naturalWidth * scale)),
        h = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.width = Math.max(64, w, Math.ceil(h / 19));
      canvas.height = Math.max(64, h, Math.ceil(w / 19));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Не удалось подготовить фото");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        image,
        (canvas.width - w) / 2,
        (canvas.height - h) / 2,
        w,
        h,
      );
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (!blob) throw new Error("Не удалось подготовить фото");
      if (blob.size <= 850 * 1024) {
        const thumb = document.createElement("canvas"),
          ratio = Math.min(1, 320 / Math.max(canvas.width, canvas.height));
        thumb.width = Math.max(1, Math.round(canvas.width * ratio));
        thumb.height = Math.max(1, Math.round(canvas.height * ratio));
        thumb
          .getContext("2d")
          .drawImage(canvas, 0, 0, thumb.width, thumb.height);
        const thumbnail = await new Promise((resolve) =>
          thumb.toBlob(resolve, "image/jpeg", 0.75),
        );
        return {
          id: postRequestId(),
          file: new File(
            [blob],
            `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`,
            { type: "image/jpeg" },
          ),
          thumbnail,
        };
      }
      if (quality > 0.5) quality -= 0.12;
      else {
        scale *= 0.75;
        quality = 0.8;
      }
    }
    throw new Error(
      "Фото слишком большое. Выберите изображение меньшего размера.",
    );
  } finally {
    image.src = "";
    URL.revokeObjectURL(url);
  }
}
