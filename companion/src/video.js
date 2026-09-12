// Separate, replaceable video lane. Each datagram is <= 18 KiB; at most one
// incomplete <= 96 KiB JPEG is retained. Video never extends control freshness.
const LABEL = 'professor-video-v1';
const CHUNK = 16384, MAX = 131072;
export function installVideoLane(transport, connection, { receive = () => {}, now = () => performance.now() } = {}) {
  let channel = null, candidateChannel = null, partial = null, frameId = 0, lastCompleted = 0, closed = false;
  const ready = () => !closed && connection.phase === 'ready' && connection.acceptedScopes.includes('runner.video');
  function attach(candidate, peerKey) {
    if (!ready() || peerKey !== connection.peerKey || channel) { candidate?.close(); return; }
    channel = candidate;
    channel.addEventListener('message', event => {
      if (!ready() || channel !== candidate || transport.role !== 'controller') return;
      if (typeof event.data !== 'string' || event.data.length > 18000) return;
      let packet; try { packet = JSON.parse(event.data); } catch { return; }
      if (Object.keys(packet).sort().join(',') !== 'data,height,id,part,positionEstimateMs,runId,selection,total,width'
        || !Number.isSafeInteger(packet.id) || packet.id <= lastCompleted || packet.id < 1
        || !Number.isInteger(packet.total) || packet.total < 1 || packet.total > 8
        || !Number.isInteger(packet.part) || packet.part < 0 || packet.part >= packet.total
        || typeof packet.data !== 'string' || packet.data.length > CHUNK || !/^[A-Za-z0-9+/]*={0,2}$/u.test(packet.data)
        || typeof packet.runId !== 'string' || packet.runId.length > 96
        || typeof packet.selection !== 'string' || packet.selection.length > 96
        || !Number.isInteger(packet.width) || packet.width < 1 || packet.width > 640
        || !Number.isInteger(packet.height) || packet.height < 1 || packet.height > 360
        || !(packet.positionEstimateMs === null || (Number.isFinite(packet.positionEstimateMs) && packet.positionEstimateMs >= 0))) return;
      const { data, part, ...metadata } = packet;
      if (!partial || packet.id > partial.id || now() - partial.started > 2000) {
        partial = { id: packet.id, metadata: JSON.stringify(metadata), started: now(), parts: new Map() };
      }
      if (partial.id !== packet.id || partial.metadata !== JSON.stringify(metadata)) return;
      partial.parts.set(part, data);
      if (partial.parts.size !== packet.total) return;
      const base64 = Array.from({ length: packet.total }, (_, i) => partial.parts.get(i)).join('');
      partial = null; lastCompleted = packet.id;
      if (!base64.length || base64.length > MAX) return;
      receive({ ...metadata, base64 });
    });
  }
  const open = event => {
    const d = event.detail;
    if (transport.role === 'controller' && (d?.label === LABEL || d?.label === `x-${LABEL}`) && d?.uuid === connection.peerKey) {
      if (ready()) attach(d.channel, d.uuid);
      else if (!candidateChannel) candidateChannel = d;
      else d.channel.close();
    }
  };
  const install = transport.installSdkListeners.bind(transport);
  transport.installSdkListeners = (sdk, generation) => { install(sdk, generation); transport.listen(sdk, generation, 'channelOpen', open); };
  async function start() {
    if (!ready()) return;
    if (candidateChannel) { attach(candidateChannel.channel, candidateChannel.uuid); candidateChannel = null; }
    if (transport.role === 'target') {
      try {
        const peer = connection.peerKey;
        const candidate = await transport.sdk.openChannel(peer, LABEL, { ordered: false, maxRetransmits: 0 });
        attach(candidate, peer);
      } catch { /* Video is optional; control/state continue. */ }
    }
  }
  connection.addEventListener('ready', start);
  return {
    send(projection) {
      if (!ready() || !channel || channel.readyState !== 'open' || channel.bufferedAmount > 0) return false;
      const f = projection.frame, base64 = f.jpegBase64;
      if (!base64?.length || base64.length > MAX) return false;
      const total = Math.ceil(base64.length / CHUNK), id = ++frameId;
      try {
        for (let part = 0; part < total; part++) channel.send(JSON.stringify({ id, part, total,
          runId: projection.runId, selection: projection.selection, width: f.width, height: f.height,
          positionEstimateMs: f.positionEstimateMs, data: base64.slice(part * CHUNK, (part + 1) * CHUNK) }));
        return true;
      } catch { return false; }
    },
    close() { closed = true; partial = null; candidateChannel?.channel.close(); candidateChannel = null; channel?.close(); channel = null;
      connection.removeEventListener('ready', start); transport.sdk?.removeEventListener('channelOpen', open); },
  };
}
