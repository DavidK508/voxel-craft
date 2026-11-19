export class WorkerPool {
  constructor(size = 4) {
    this.size = size;
    this.workers = [];
    this.pending = new Map();
    this.nextId = 1;
    this.cursor = 0;
    this.closed = false;
    for (let i = 0; i < size; i++) this.spawn(i);
  }

  spawn(slot) {
    const worker = new Worker(new URL('../workers/chunkWorker.js', import.meta.url), {
      type: 'module',
      name: `voxel-worker-${slot}`,
    });
    worker.slot = slot;
    worker.current = new Set();
    worker.onmessage = (event) => {
      const { taskId } = event.data;
      const task = this.pending.get(taskId);
      if (!task) return;
      this.pending.delete(taskId);
      worker.current.delete(taskId);
      if (event.data.type === 'error') {
        task.reject(new Error(event.data.message));
      } else {
        task.resolve(event.data);
      }
    };
    worker.onerror = (event) => {
      console.error(`[worker ${slot}]`, event.message || event);
      for (const taskId of [...worker.current]) {
        const task = this.pending.get(taskId);
        if (task) {
          this.pending.delete(taskId);
          task.reject(new Error(event.message || 'Worker crashed'));
        }
      }
      worker.current.clear();
      if (!this.closed) {
        worker.terminate();
        this.workers[slot] = null;
        setTimeout(() => {
          if (!this.closed) this.spawn(slot);
        }, 250);
      }
    };
    this.workers[slot] = worker;
  }

  run(type, payload, transfer = []) {
    if (this.closed) return Promise.reject(new Error('Worker pool closed'));
    let worker = null;
    for (let i = 0; i < this.size; i++) {
      const index = (this.cursor + i) % this.size;
      if (this.workers[index]) {
        worker = this.workers[index];
        this.cursor = (index + 1) % this.size;
        break;
      }
    }
    if (!worker) {
      return new Promise((resolve, reject) => {
        setTimeout(() => this.run(type, payload, transfer).then(resolve, reject), 50);
      });
    }
    const taskId = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(taskId, { resolve, reject, worker });
      worker.current.add(taskId);
      worker.postMessage({ ...payload, taskId, type }, transfer);
    });
  }

  terminate() {
    this.closed = true;
    for (const worker of this.workers) worker?.terminate();
    this.workers = [];
    for (const task of this.pending.values()) task.reject(new Error('Worker pool terminated'));
    this.pending.clear();
  }
}
