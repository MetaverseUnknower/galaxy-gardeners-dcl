// Runs an async job one at a time. A call while it's running doesn't start a second copy: the job runs once more
// when the current run finishes (however many calls came in meanwhile), and every caller waits for that.
export function oneAtATime(job: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null
  let again = false
  return () => {
    if (running) { again = true; return running }
    running = (async () => {
      do { again = false; await job() } while (again)
    })().finally(() => { running = null })
    return running
  }
}
