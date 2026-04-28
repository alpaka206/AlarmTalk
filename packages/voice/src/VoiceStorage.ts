import { z } from 'zod';

export const StoreInputSchema = z.object({
  userId: z.string().min(1),
  bytes: z.instanceof(Uint8Array),
  mimeType: z.string().min(1).max(100),
  durationMs: z.number().int().positive().optional(),
  originalName: z.string().max(200).optional(),
});
export type StoreInput = z.infer<typeof StoreInputSchema>;

export const StoredObjectSchema = z.object({
  objectKey: z.string().min(1),
  userId: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  durationMs: z.number().int().positive().optional(),
  originalName: z.string().optional(),
  createdAt: z.string().min(1),
});
export type StoredObject = z.infer<typeof StoredObjectSchema>;

export interface VoiceStorage {
  readonly name: string;
  store(input: StoreInput): Promise<StoredObject>;
  get(objectKey: string): Promise<{ meta: StoredObject; bytes: Uint8Array } | null>;
  delete(objectKey: string): Promise<boolean>;
}

// Production: R2VoiceStorage (packages/backend/src/lib/r2-storage.ts). This in-memory impl is for dev/test fallback.
export class InMemoryVoiceStorage implements VoiceStorage {
  readonly name = 'memory';
  private items = new Map<string, { meta: StoredObject; bytes: Uint8Array }>();
  private counter = 0;

  async store(input: StoreInput): Promise<StoredObject> {
    const parsed = StoreInputSchema.parse(input);
    this.counter += 1;
    const objectKey = `mem://${parsed.userId}/${Date.now()}_${this.counter}`;
    const meta: StoredObject = {
      objectKey,
      userId: parsed.userId,
      mimeType: parsed.mimeType,
      sizeBytes: parsed.bytes.byteLength,
      durationMs: parsed.durationMs,
      originalName: parsed.originalName,
      createdAt: new Date().toISOString(),
    };
    this.items.set(objectKey, { meta, bytes: parsed.bytes });
    return meta;
  }

  async get(objectKey: string): Promise<{ meta: StoredObject; bytes: Uint8Array } | null> {
    return this.items.get(objectKey) ?? null;
  }

  async delete(objectKey: string): Promise<boolean> {
    return this.items.delete(objectKey);
  }

  reset(): void {
    this.items.clear();
    this.counter = 0;
  }

  size(): number {
    return this.items.size;
  }
}

let sharedStorage: InMemoryVoiceStorage | null = null;
export function getSharedInMemoryVoiceStorage(): InMemoryVoiceStorage {
  if (!sharedStorage) sharedStorage = new InMemoryVoiceStorage();
  return sharedStorage;
}
export function resetSharedInMemoryVoiceStorage(): void {
  sharedStorage?.reset();
}
