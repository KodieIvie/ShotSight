import type { GrayImage } from '../types';

export function makeTarget(width = 160, height = 120): GrayImage {
  const data = new Float32Array(width * height);
  const centerX = width / 2;
  const centerY = height / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY);
      let value = 178 + ((x * 13 + y * 7) % 11) - 5;
      if (Math.abs(distance - 34) < 1.5 || Math.abs(distance - 18) < 1.5) {
        value = 70;
      }
      if (Math.abs(x - centerX) < 1 || Math.abs(y - centerY) < 1) {
        value = Math.min(value, 105);
      }
      if ((x > 12 && x < 26 && y > 13 && y < 17) || (x > 126 && x < 140 && y > 92 && y < 97)) {
        value = 115;
      }
      data[y * width + x] = value;
    }
  }
  return { width, height, data };
}

/** Creates moving such that moving(x + offsetX, y + offsetY) matches reference(x, y). */
export function shiftImage(
  reference: GrayImage,
  offsetX: number,
  offsetY: number,
  fill = 178,
): GrayImage {
  const data = new Float32Array(reference.data.length);
  data.fill(fill);
  for (let y = 0; y < reference.height; y += 1) {
    for (let x = 0; x < reference.width; x += 1) {
      const destinationX = x + offsetX;
      const destinationY = y + offsetY;
      if (
        destinationX >= 0 &&
        destinationX < reference.width &&
        destinationY >= 0 &&
        destinationY < reference.height
      ) {
        data[destinationY * reference.width + destinationX] =
          reference.data[y * reference.width + x];
      }
    }
  }
  return { width: reference.width, height: reference.height, data };
}

export function addDarkImpact(image: GrayImage, x: number, y: number, radius = 4): GrayImage {
  const data = new Float32Array(image.data);
  for (let sampleY = Math.floor(y - radius); sampleY <= Math.ceil(y + radius); sampleY += 1) {
    for (let sampleX = Math.floor(x - radius); sampleX <= Math.ceil(x + radius); sampleX += 1) {
      if (
        sampleX >= 0 &&
        sampleX < image.width &&
        sampleY >= 0 &&
        sampleY < image.height &&
        Math.hypot(sampleX - x, sampleY - y) <= radius
      ) {
        data[sampleY * image.width + sampleX] = 24;
      }
    }
  }
  return { width: image.width, height: image.height, data };
}

export function applyExposure(image: GrayImage, scale: number, offset: number): GrayImage {
  return {
    width: image.width,
    height: image.height,
    data: Float32Array.from(image.data, (value) =>
      Math.min(255, Math.max(0, value * scale + offset)),
    ),
  };
}

