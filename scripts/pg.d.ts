declare module 'pg' {
  export class Client {
    constructor(config?: Record<string, unknown>);
    connect(): Promise<void>;
    end(): Promise<void>;
    query(
      text: string,
      values?: ReadonlyArray<unknown>
    ): Promise<{ rows: Array<Record<string, unknown>> }>;
  }
}
