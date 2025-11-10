import type { Vendor } from '../types';

export interface EncryptedPayload {
  version: 1;
  salt: string;
  iv: string;
  data: string;
  createdAt: number;
}

const LOCAL_STORAGE_KEY = 'odm_encrypted_keys_v1';
const PBKDF2_ITERATIONS = 120_000;
const PBKDF2_HASH = 'SHA-256';
const AES_ALGO = 'AES-GCM';
const AES_KEY_LENGTH = 256;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const getCrypto = (): Crypto | undefined => {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    return window.crypto;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).crypto?.subtle) {
    return (globalThis as any).crypto as Crypto;
  }
  return undefined;
};

const toBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  if (typeof window === 'undefined') {
    const g = globalThis as any;
    if (g && g.Buffer) {
      return g.Buffer.from(bytes).toString('base64');
    }
  }
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return globalThis.btoa ? globalThis.btoa(binary) : BufferFallback(binary, 'encode');
};

const fromBase64 = (b64: string): ArrayBuffer => {
  if (typeof window === 'undefined') {
    const g = globalThis as any;
    if (g && g.Buffer) {
      return Uint8Array.from(g.Buffer.from(b64, 'base64')).buffer;
    }
  }
  const binary = globalThis.atob ? globalThis.atob(b64) : BufferFallback(b64, 'decode');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

const BufferFallback = (input: string, mode: 'encode' | 'decode'): string => {
  const g = globalThis as any;
  if (!g || !g.Buffer) {
    throw new Error('当前环境不支持 Base64 转换');
  }
  if (mode === 'encode') {
    return g.Buffer.from(input, 'binary').toString('base64');
  }
  return g.Buffer.from(input, 'base64').toString('binary');
};

const importEncryptionKey = async (password: string, salt: Uint8Array, cryptoObj: Crypto) => {
  const baseKey = await cryptoObj.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return cryptoObj.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    baseKey,
    {
      name: AES_ALGO,
      length: AES_KEY_LENGTH,
    },
    false,
    ['encrypt', 'decrypt'],
  );
};

export const encryptSecrets = async (
  payload: Record<Vendor, string>,
  password: string,
): Promise<EncryptedPayload> => {
  const cryptoObj = getCrypto();
  if (!cryptoObj) {
    throw new Error('当前环境不支持 WebCrypto，无法执行本地加密。');
  }
  const salt = cryptoObj.getRandomValues(new Uint8Array(16));
  const iv = cryptoObj.getRandomValues(new Uint8Array(12));
  const key = await importEncryptionKey(password, salt, cryptoObj);
  const plaintext = textEncoder.encode(JSON.stringify(payload));
  const ciphertext = await cryptoObj.subtle.encrypt({ name: AES_ALGO, iv }, key, plaintext);
  return {
    version: 1,
    salt: toBase64(salt.buffer),
    iv: toBase64(iv.buffer),
    data: toBase64(ciphertext),
    createdAt: Date.now(),
  };
};

export const decryptSecrets = async (
  payload: EncryptedPayload,
  password: string,
): Promise<Record<Vendor, string>> => {
  const cryptoObj = getCrypto();
  if (!cryptoObj) {
    throw new Error('当前环境不支持 WebCrypto，无法执行本地解密。');
  }

  const salt = new Uint8Array(fromBase64(payload.salt));
  const iv = new Uint8Array(fromBase64(payload.iv));
  const ciphertext = fromBase64(payload.data);
  const key = await importEncryptionKey(password, salt, cryptoObj);
  const plaintext = await cryptoObj.subtle.decrypt({ name: AES_ALGO, iv }, key, ciphertext);
  const decoded = textDecoder.decode(plaintext);
  return JSON.parse(decoded) as Record<Vendor, string>;
};

export const writeEncryptedSecretsToStorage = (payload: EncryptedPayload) => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
};

export const readEncryptedSecretsFromStorage = (): EncryptedPayload | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed.version === 1 && parsed.salt && parsed.iv && parsed.data) {
      return parsed as EncryptedPayload;
    }
  } catch (err) {
    console.warn('Failed to parse encrypted secrets from storage', err);
  }
  return undefined;
};

export const clearEncryptedSecretsStorage = () => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(LOCAL_STORAGE_KEY);
};
