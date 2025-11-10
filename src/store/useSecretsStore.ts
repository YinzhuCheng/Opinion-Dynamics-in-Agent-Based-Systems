import { create } from 'zustand';
import type { Vendor } from '../types';
import type { EncryptedPayload } from '../utils/crypto';
import {
  clearEncryptedSecretsStorage,
  decryptSecrets,
  encryptSecrets,
  readEncryptedSecretsFromStorage,
  writeEncryptedSecretsToStorage,
} from '../utils/crypto';

type VendorKeyMap = Partial<Record<Vendor, string>>;

interface SecretsState {
  apiKeys: VendorKeyMap;
  encryptionEnabled: boolean;
  encryptionUnlocked: boolean;
  hasStoredCiphertext: boolean;
  encryptedBundle?: EncryptedPayload;
  lastSavedAt?: number;
  error?: string;
  passphrase?: string;
  initializeFromStorage: () => void;
  setApiKey: (vendor: Vendor, apiKey: string) => Promise<void>;
  clearApiKey: (vendor: Vendor) => Promise<void>;
  saveEncrypted: (password: string) => Promise<void>;
  loadEncrypted: (password: string) => Promise<boolean>;
  disableEncryption: () => void;
  forgetEncrypted: () => void;
  setError: (error?: string) => void;
}

const persistKeys = async (
  apiKeys: VendorKeyMap,
  password: string,
): Promise<{ bundle: EncryptedPayload; persistedAt: number }> => {
  const filtered: Record<Vendor, string> = {} as Record<Vendor, string>;
  (Object.entries(apiKeys) as [Vendor, string][]).forEach(([vendor, key]) => {
    if (key) {
      filtered[vendor] = key;
    }
  });
  const bundle = await encryptSecrets(filtered, password);
  writeEncryptedSecretsToStorage(bundle);
  return { bundle, persistedAt: bundle.createdAt };
};

export const useSecretsStore = create<SecretsState>((set, get) => ({
  apiKeys: {},
  encryptionEnabled: false,
  encryptionUnlocked: false,
  hasStoredCiphertext: false,
  encryptedBundle: undefined,
  lastSavedAt: undefined,
  passphrase: undefined,
  error: undefined,
  initializeFromStorage: () => {
    const stored = readEncryptedSecretsFromStorage();
    if (stored) {
      set({
        hasStoredCiphertext: true,
        encryptedBundle: stored,
        encryptionEnabled: true,
        encryptionUnlocked: false,
        lastSavedAt: stored.createdAt,
      });
    }
  },
  setApiKey: async (vendor, apiKey) => {
    set((state) => ({
      apiKeys: { ...state.apiKeys, [vendor]: apiKey },
    }));

    const { encryptionEnabled, encryptionUnlocked, encryptedBundle, passphrase } = get();
    if (encryptionEnabled && encryptionUnlocked && encryptedBundle) {
      if (!passphrase) {
        set({ encryptionUnlocked: false });
        throw new Error('加密存储已启用，但当前会话未输入口令。');
      }
      try {
        const { bundle, persistedAt } = await persistKeys(get().apiKeys, passphrase);
        set({
          encryptedBundle: bundle,
          lastSavedAt: persistedAt,
        });
      } catch (error: any) {
        set({ error: error?.message ?? '保存加密密钥失败。' });
        throw error;
      }
    }
  },
  clearApiKey: async (vendor) => {
    set((state) => {
      const next = { ...state.apiKeys };
      delete next[vendor];
      return { apiKeys: next };
    });
    const { encryptionEnabled, encryptionUnlocked, encryptedBundle, passphrase } = get();
    if (encryptionEnabled && encryptionUnlocked && encryptedBundle) {
      if (!passphrase) {
        set({ encryptionUnlocked: false });
        throw new Error('加密存储已启用，但当前会话未输入口令。');
      }
      try {
        const { bundle, persistedAt } = await persistKeys(get().apiKeys, passphrase);
        set({
          encryptedBundle: bundle,
          lastSavedAt: persistedAt,
        });
      } catch (error: any) {
        set({ error: error?.message ?? '保存加密密钥失败。' });
        throw error;
      }
    }
  },
  saveEncrypted: async (password: string) => {
    try {
      const { bundle, persistedAt } = await persistKeys(get().apiKeys, password);
      set({
        encryptionEnabled: true,
        encryptionUnlocked: true,
        hasStoredCiphertext: true,
        encryptedBundle: bundle,
        lastSavedAt: persistedAt,
        passphrase: password,
        error: undefined,
      });
    } catch (error: any) {
      set({ error: error?.message ?? '保存加密密钥失败。' });
      throw error;
    }
  },
  loadEncrypted: async (password: string) => {
    const stored = get().encryptedBundle ?? readEncryptedSecretsFromStorage();
    if (!stored) {
      set({ error: '未找到可解密的数据。' });
      return false;
    }
    try {
      const decrypted = await decryptSecrets(stored, password);
      set({
        apiKeys: decrypted,
        encryptionUnlocked: true,
        encryptionEnabled: true,
        hasStoredCiphertext: true,
        lastSavedAt: stored.createdAt,
        encryptedBundle: stored,
        passphrase: password,
        error: undefined,
      });
      return true;
    } catch (error: any) {
      set({ error: error?.message ?? '解密失败，请检查口令。' });
      return false;
    }
  },
  disableEncryption: () => {
    clearEncryptedSecretsStorage();
    set({
      encryptionEnabled: false,
      encryptionUnlocked: false,
      hasStoredCiphertext: false,
      encryptedBundle: undefined,
      lastSavedAt: undefined,
        passphrase: undefined,
    });
  },
  forgetEncrypted: () => {
    clearEncryptedSecretsStorage();
    set({
      hasStoredCiphertext: false,
      encryptedBundle: undefined,
      lastSavedAt: undefined,
        passphrase: undefined,
    });
  },
  setError: (error) => set({ error }),
}));
