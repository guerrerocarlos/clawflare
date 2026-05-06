export class SessionLanes {
  private readonly lanes = new Map<string, Promise<unknown>>();

  async runExclusive<T>(sessionKey: string, task: () => Promise<T>): Promise<T> {
    const previous = this.lanes.get(sessionKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    const tail = previous
      .catch(() => undefined)
      .then(() => current)
      .finally(() => {
        if (this.lanes.get(sessionKey) === tail) {
          this.lanes.delete(sessionKey);
        }
      });

    this.lanes.set(sessionKey, tail);

    await previous.catch(() => undefined);

    try {
      return await task();
    } finally {
      release();
    }
  }
}
