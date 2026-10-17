export class HaError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "HaError";
  }
}
