import { Capacitor } from '@capacitor/core';
import { Camera, CameraDirection, CameraResultType, CameraSource } from '@capacitor/camera';

export const PRODUCTION_API_ORIGIN = 'https://cycle.bdfzscc.com';
export const isNativeApp = Capacitor.isNativePlatform();

export function apiUrl(path: string) {
  if (!path.startsWith('/')) throw new Error('API path must start with /');
  return isNativeApp ? `${PRODUCTION_API_ORIGIN}${path}` : path;
}

export function mediaUrl(path: string | null | undefined) {
  return path ? apiUrl(path) : undefined;
}

async function nativePhoto(source: CameraSource) {
  const photo = await Camera.getPhoto({
    source,
    resultType: CameraResultType.Uri,
    direction: CameraDirection.Rear,
    quality: 92,
    width: 2048,
    height: 2048,
    correctOrientation: true,
    saveToGallery: false,
  });
  if (!photo.webPath) throw new Error('相机没有返回照片，请重试');
  const response = await fetch(photo.webPath);
  if (!response.ok) throw new Error('无法读取刚拍摄的照片，请重试');
  const blob = await response.blob();
  const extension = photo.format === 'png' ? 'png' : photo.format === 'webp' ? 'webp' : 'jpg';
  return new File([blob], `camera-${Date.now()}.${extension}`, { type: blob.type || `image/${extension === 'jpg' ? 'jpeg' : extension}` });
}

export const takeNativePhoto = () => nativePhoto(CameraSource.Camera);
export const chooseNativePhoto = () => nativePhoto(CameraSource.Photos);

export function isCameraCancellation(error: unknown) {
  const value = error as { message?: string; code?: string };
  return value.code === 'userCancelled' || /cancel|取消/i.test(value.message ?? '');
}
