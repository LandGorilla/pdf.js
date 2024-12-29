export class ConcurrencyQueue {
    /**
     * @param {number} concurrency - The number of tasks to run in parallel.
     */
    constructor(concurrency = 2) {
      this.concurrency = concurrency;
      this.queue = [];
      this.activeCount = 0;
      this.results = [];
      this.currentIndex = 0;
    }
  
    /**
     * Add a task to the queue.
     * @param {Function} task - A function that returns a Promise.
     */
    addTask(task) {
      this.queue.push(task);
    }
  
    /**
     * Start running the tasks in the queue.
     * @returns {Promise<Array>} A promise that resolves with an array of results (or errors).
     */
    run() {
      return new Promise((resolve) => {
        const runNext = () => {
          // If no tasks left and no active tasks, we are done
          if (this.queue.length === 0 && this.activeCount === 0) {
            resolve(this.results);
            return;
          }
  
          // Fill up the concurrency slots
          while (this.activeCount < this.concurrency && this.queue.length > 0) {
            const task = this.queue.shift();
            const taskIndex = this.currentIndex++;
            this.activeCount++;
  
            // Execute the task
            task()
              .then((result) => {
                this.results[taskIndex] = result;
              })
              .catch((error) => {
                this.results[taskIndex] = { error: error.message || error };
              })
              .finally(() => {
                this.activeCount--;
                runNext();
              });
          }
        };
  
        runNext();
      });
    }
  }