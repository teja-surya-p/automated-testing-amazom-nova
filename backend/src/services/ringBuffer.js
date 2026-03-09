export class RingBuffer {
  constructor(limit) {
    this.limit = limit;
    this.items = [];
  }

  push(item) {
    this.items.push(item);
    if (this.items.length > this.limit) {
      this.items.shift();
    }
  }

  values() {
    return [...this.items];
  }
}
