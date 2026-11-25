import type { EventHandler } from '@/core/types';

class InternalEventBus {
  private listeners: Map<string, EventHandler<never>[]> = new Map();

  on<T>(event: string, handler: EventHandler<T>) {
    const existing = this.listeners.get(event) || [];
    this.listeners.set(event, [...existing, handler]);
  }

  async emit<T>(event: string, payload: T) {
    const handlers = this.listeners.get(event) || [];
    for (const handler of handlers) {
      await handler(payload as never);
    }
  }
}

export const eventBus = new InternalEventBus();
