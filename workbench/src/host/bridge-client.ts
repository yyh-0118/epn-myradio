import { HOST_CHANNEL, HOST_VERSION, isEnvelope, type BridgeEnvelope, type HostCapture, type HostSnapshot, type HostTrack, type PlaybackResponse, type StorageOperation, type StorageResponse } from './contract';

type Listener = (snapshot: HostSnapshot | null, capture?: HostCapture) => void;
type FlushHandler = (reason: string) => Promise<{ ok: boolean; error?: string }>;

export class MineradioBridge {
  private port: MessagePort | null = null;
  private sessionId = '';
  private seq = 0;
  private latestSeq = -1;
  private listener: Listener | null = null;
  private flushHandler: FlushHandler | null = null;
  private connectTimer = 0;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>();
  private rejectPending(message: string) {
    for (const entry of this.pending.values()) {
      window.clearTimeout(entry.timer);
      entry.reject(new Error(message));
    }
    this.pending.clear();
  }
  private readonly onWindowMessage = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    const message = event.data as Partial<BridgeEnvelope>;
    if (message.channel !== HOST_CHANNEL || message.version !== HOST_VERSION || message.type !== 'host.connect' || !event.ports[0] || typeof message.sessionId !== 'string') return;
    this.rejectPending('播放器连接已更新，请重试。');
    this.port?.close();
    this.port = event.ports[0];
    this.sessionId = message.sessionId;
    this.latestSeq = -1;
    this.port.onmessage = this.onPortMessage;
    this.port.start();
    window.clearInterval(this.connectTimer);
    this.connectTimer = 0;
    this.send('child.connected');
  };
  private readonly onPortMessage = (event: MessageEvent) => {
    if (!isEnvelope(event.data) || event.data.sessionId !== this.sessionId || event.data.seq <= this.latestSeq) return;
    this.latestSeq = event.data.seq;
    if (event.data.type === 'host.snapshot' || event.data.type === 'host.state') this.listener?.(event.data.payload as HostSnapshot);
    if (event.data.type === 'host.capture') this.listener?.(null, event.data.payload as HostCapture);
    if (event.data.type === 'host.flush.request' && event.data.requestId) {
      const reason = String((event.data.payload as { reason?: unknown } | undefined)?.reason || 'host-request');
      void Promise.resolve(this.flushHandler ? this.flushHandler(reason) : { ok: true }).then((result) => {
        this.sendResponse('child.flush.result', event.data.requestId!, result);
      }).catch(() => this.sendResponse('child.flush.result', event.data.requestId!, { ok: false, error: 'SAVE_FAILED' }));
      return;
    }
    if ((event.data.type === 'host.storage.result' || event.data.type === 'host.playback.result') && event.data.requestId) {
      const entry = this.pending.get(event.data.requestId);
      if (!entry) return;
      window.clearTimeout(entry.timer);
      this.pending.delete(event.data.requestId);
      entry.resolve(event.data.payload);
    }
  };
  setFlushHandler(handler: FlushHandler) {
    this.flushHandler = handler;
  }
  connect(listener: Listener) {
    this.listener = listener;
    window.addEventListener('message', this.onWindowMessage);
    const announce = () => window.parent.postMessage({ channel: HOST_CHANNEL, version: HOST_VERSION, type: 'child.ready' }, window.location.origin);
    announce();
    this.connectTimer = window.setInterval(announce, 1000);
  }
  send(type: string, payload?: unknown) {
    if (!this.port || !this.sessionId) return false;
    this.port.postMessage({ channel: HOST_CHANNEL, version: HOST_VERSION, sessionId: this.sessionId, seq: ++this.seq, type, payload });
    return true;
  }
  private sendResponse(type: string, requestId: string, payload: unknown) {
    if (!this.port || !this.sessionId) return false;
    this.port.postMessage({ channel: HOST_CHANNEL, version: HOST_VERSION, sessionId: this.sessionId, seq: ++this.seq, type, requestId, payload });
    return true;
  }
  requestStorage(operation: StorageOperation, payload?: unknown): Promise<StorageResponse> {
    if (!this.port || !this.sessionId) return Promise.reject(new Error('播放器存储尚未连接。'));
    const requestId = crypto.randomUUID();
    const timeout = operation === 'exportNotebook' || operation === 'prepareImport' ? 10 * 60_000
      : operation === 'commitImport' || operation === 'restoreBackup' ? 30_000 : 5000;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('本机存储响应超时。'));
      }, timeout);
      this.pending.set(requestId, { resolve: (value) => resolve(value as StorageResponse), reject, timer });
      this.port!.postMessage({
        channel: HOST_CHANNEL, version: HOST_VERSION, sessionId: this.sessionId,
        seq: ++this.seq, type: 'child.storage.request', requestId, payload: { operation, payload },
      });
    });
  }
  restoreTrack(track: HostTrack, time: number, autoplay = true): Promise<PlaybackResponse> {
    if (!this.port || !this.sessionId) return Promise.reject(new Error('播放器尚未连接。'));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('恢复歌曲响应超时。'));
      }, 60_000);
      this.pending.set(requestId, { resolve: (value) => resolve(value as PlaybackResponse), reject, timer });
      this.port!.postMessage({
        channel: HOST_CHANNEL, version: HOST_VERSION, sessionId: this.sessionId,
        seq: ++this.seq, type: 'child.restoreTrack', requestId,
        payload: { track, time: Math.max(0, time), autoplay },
      });
    });
  }
  close() {
    window.removeEventListener('message', this.onWindowMessage);
    window.clearInterval(this.connectTimer);
    this.rejectPending('工作台已关闭。');
    this.port?.close();
    this.port = null;
  }
}
