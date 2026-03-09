export class EventBus {
  constructor() {
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(type, payload) {
    for (const listener of this.listeners) {
      listener(type, payload);
    }
  }
}
