import { app, safeStorage } from 'electron';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { modelIdSchema, type AgentState } from '@edi/contracts';

export class AgentService {
  state: AgentState = { configured: false, model: '', status: 'idle', text: '', error: '' };
  private apiKey = '';
  private worker?: Worker;
  private timeout?: ReturnType<typeof setTimeout>;
  private configuring = false;
  constructor(private publish: (state: AgentState) => void) {}
  private path() {
    return join(app.getPath('userData'), 'openrouter.enc');
  }
  private emit() {
    this.publish({ ...this.state });
  }
  async load() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return;
      const saved = JSON.parse(safeStorage.decryptString(await readFile(this.path())));
      const model = modelIdSchema.parse(saved.model);
      if (typeof saved.apiKey !== 'string' || saved.apiKey.length < 10) return;
      this.apiKey = saved.apiKey;
      this.state = { ...this.state, configured: true, model };
    } catch {
      /* Missing or locked credentials require setup again. */
    }
  }
  async configure(apiKey: string, model: string) {
    if (this.configuring || this.worker)
      throw new Error('Stop the response before changing the connection.');
    this.configuring = true;
    try {
      if (
        !safeStorage.isEncryptionAvailable() ||
        (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
      )
        throw new Error('Secure credential storage is unavailable.');
      const encrypted = safeStorage.encryptString(JSON.stringify({ apiKey, model }));
      await mkdir(app.getPath('userData'), { recursive: true });
      await writeFile(`${this.path()}.tmp`, encrypted, { mode: 0o600 });
      await rename(`${this.path()}.tmp`, this.path());
      this.apiKey = apiKey;
      this.state = { configured: true, model, status: 'idle', text: '', error: '' };
      this.emit();
    } finally {
      this.configuring = false;
    }
  }
  async disconnect() {
    if (this.configuring) throw new Error('Connection update in progress.');
    this.configuring = true;
    try {
      this.stop();
      await unlink(this.path()).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      this.apiKey = '';
      this.state = { configured: false, model: '', status: 'idle', text: '', error: '' };
      this.emit();
    } finally {
      this.configuring = false;
    }
  }
  ask(prompt: string) {
    if (!this.apiKey || this.configuring) throw new Error('Set up OpenRouter first.');
    if (this.worker) throw new Error('A response is already running.');
    this.state = { ...this.state, status: 'running', text: '', error: '' };
    const worker = new Worker(join(__dirname, 'agent-worker.js'), {
      workerData: { apiKey: this.apiKey, model: this.state.model, prompt },
    });
    this.worker = worker;
    this.emit();
    const finish = (status: AgentState['status'], error = '') => {
      if (this.worker !== worker) return;
      clearTimeout(this.timeout);
      this.worker = undefined;
      void worker.terminate();
      this.state = { ...this.state, status, error };
      this.emit();
    };
    worker.on('message', message => {
      if (this.worker !== worker) return;
      if (message.type === 'text' && typeof message.text === 'string') {
        if (this.state.text.length + message.text.length > 32000) {
          finish('error', 'Response reached the display limit. Ask for a shorter answer.');
          return;
        }
        this.state = { ...this.state, text: this.state.text + message.text };
        this.emit();
      } else if (message.type === 'done') {
        finish(
          this.state.text ? 'done' : 'error',
          this.state.text ? '' : 'No text was returned. Try a text-capable model.',
        );
      } else
        finish(
          'error',
          'OpenRouter could not complete this response. Check your key, model ID, credits, and connection.',
        );
    });
    worker.on('error', () => finish('error', 'The response worker could not start.'));
    worker.on('exit', () => finish('error', 'The response worker ended unexpectedly.'));
    this.timeout = setTimeout(
      () => finish('error', 'The response timed out. You can try again.'),
      120000,
    );
  }
  stop() {
    clearTimeout(this.timeout);
    const worker = this.worker;
    this.worker = undefined;
    if (worker) {
      worker.postMessage('stop');
      void worker.terminate();
      this.state = { ...this.state, status: 'stopped' };
      this.emit();
    }
  }
}
