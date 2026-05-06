import type { ClawflareEnv } from "../env";

export interface R2Buckets {
  transcripts: R2Bucket;
  artifacts: R2Bucket;
  pluginArchives: R2Bucket;
}

export interface PutObjectOptions {
  contentType?: string;
  customMetadata?: Record<string, string>;
}

export class R2Storage {
  constructor(private readonly buckets: R2Buckets) {}

  async putTranscript(key: string, body: string | ReadableStream, options?: PutObjectOptions): Promise<R2Object> {
    return await this.put(this.buckets.transcripts, key, body, options ?? { contentType: "application/jsonl" });
  }

  async getTranscriptText(key: string): Promise<string | null> {
    return await this.getText(this.buckets.transcripts, key);
  }

  async putRunEvents(key: string, body: string | ReadableStream, options?: PutObjectOptions): Promise<R2Object> {
    return await this.put(this.buckets.transcripts, key, body, options ?? { contentType: "application/jsonl" });
  }

  async putWorkspaceObject(key: string, body: string | ArrayBuffer | ReadableStream, options?: PutObjectOptions): Promise<R2Object> {
    return await this.put(this.buckets.artifacts, key, body, options);
  }

  async getWorkspaceObjectText(key: string): Promise<string | null> {
    return await this.getText(this.buckets.artifacts, key);
  }

  async putArtifact(key: string, body: string | ArrayBuffer | ReadableStream, options?: PutObjectOptions): Promise<R2Object> {
    return await this.put(this.buckets.artifacts, key, body, options);
  }

  async putPluginArchive(key: string, body: ArrayBuffer | ReadableStream, options?: PutObjectOptions): Promise<R2Object> {
    return await this.put(this.buckets.pluginArchives, key, body, options ?? { contentType: "application/gzip" });
  }

  async putPluginManifest(key: string, body: string, options?: PutObjectOptions): Promise<R2Object> {
    return await this.put(this.buckets.pluginArchives, key, body, options ?? { contentType: "application/json" });
  }

  private async put(
    bucket: R2Bucket,
    key: string,
    body: string | ArrayBuffer | ReadableStream,
    options?: PutObjectOptions,
  ): Promise<R2Object> {
    const putOptions: R2PutOptions = {};

    if (options?.contentType !== undefined) {
      putOptions.httpMetadata = { contentType: options.contentType };
    }

    if (options?.customMetadata !== undefined) {
      putOptions.customMetadata = options.customMetadata;
    }

    return await bucket.put(key, body, putOptions);
  }

  private async getText(bucket: R2Bucket, key: string): Promise<string | null> {
    const object = await bucket.get(key);

    if (!object) {
      return null;
    }

    return await object.text();
  }
}

export function createR2Storage(env: Pick<ClawflareEnv, "TRANSCRIPTS" | "ARTIFACTS" | "PLUGIN_ARCHIVES">): R2Storage {
  return new R2Storage({
    transcripts: env.TRANSCRIPTS,
    artifacts: env.ARTIFACTS,
    pluginArchives: env.PLUGIN_ARCHIVES,
  });
}
