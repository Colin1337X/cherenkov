'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { atomicJson } = require('../adapters/node-storage');
const { parse } = require('../ai/providers');

async function createJobs(directory, upstream) {
  const filename = path.join(directory, 'jobs.json'), jobs = new Map(), running = new Map();
  let queue = Promise.resolve();
  function persist() {
    const snapshot = structuredClone([...jobs.values()]);
    const operation = queue.then(() => atomicJson(filename, snapshot));
    queue = operation.catch(() => {}); return operation;
  }
  try {
    for (const job of JSON.parse(await fs.readFile(filename, 'utf8'))) {
      if (['running', 'queued'].includes(job.status)) { job.status = 'interrupted'; job.error = 'Server stopped. Review partial output and start a new job.'; }
      jobs.set(job.id, job);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('Job history cannot be read.'); }
  if (jobs.size) await persist();
  async function run(job, profile, body, controller) {
    const timer = setTimeout(() => controller.abort(), 900000);
    const checkpoint = setInterval(() => persist().catch(() => { controller.abort(); }), 2000);
    try {
      const response = await upstream(profile, { ...body, stream: true }, controller.signal);
      const output = await parse(response, update => Object.assign(job, update), controller.signal);
      Object.assign(job, output, { status: 'completed' });
    } catch { job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.error = controller.signal.aborted ? 'Generation cancelled.' : 'Provider request failed. Check server profile and provider.'; }
    finally { clearTimeout(timer); clearInterval(checkpoint); job.finishedAt = new Date().toISOString(); await persist(); running.delete(job.id); }
  }
  async function start(profile, body, label) {
    const job = { id: randomUUID(), status: 'running', createdAt: new Date().toISOString(), content: '', label: String(label || 'Draft').slice(0, 200) };
    const controller = new AbortController();
    jobs.set(job.id, job); running.set(job.id, { controller, task: Promise.resolve() });
    try { await persist(); } catch (error) { running.delete(job.id); jobs.delete(job.id); throw error; }
    const task = run(job, profile, body, controller).catch(() => { job.status = 'failed'; running.delete(job.id); });
    running.set(job.id, { controller, task }); return job;
  }
  return { start, get: id => jobs.get(id), list: () => [...jobs.values()], active: () => running.size,
    cancel: id => running.get(id)?.controller.abort(), close: async () => { const tasks = [...running.values()]; for (const task of tasks) task.controller.abort(); await Promise.allSettled(tasks.map(t => t.task)); await queue; } };
}
module.exports = { createJobs };
