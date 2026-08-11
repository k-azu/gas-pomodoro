export interface DocumentOperationToken {
  documentKey: string;
  generation: number;
}

/**
 * Identifies the currently active asynchronous document lifecycle.
 * Starting the same document again also advances the generation so stale
 * results from a previous effect cannot mutate the new lifecycle.
 */
export class DocumentOperationGuard {
  private generation = 0;
  private current: DocumentOperationToken | null = null;

  start(documentKey: string): DocumentOperationToken {
    const token = { documentKey, generation: ++this.generation };
    this.current = token;
    return token;
  }

  capture(documentKey: string): DocumentOperationToken | null {
    return this.current?.documentKey === documentKey ? this.current : null;
  }

  isCurrent(token: DocumentOperationToken): boolean {
    return (
      this.current?.documentKey === token.documentKey &&
      this.current.generation === token.generation
    );
  }

  finish(token: DocumentOperationToken): void {
    if (this.isCurrent(token)) this.current = null;
  }
}
