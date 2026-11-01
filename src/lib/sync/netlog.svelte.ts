// Connection details for the Join page and the Host panel: what each step of a PeerJS connection did, so a failed join can be
// diagnosed from a screenshot. Addresses are never recorded, only candidate kinds.
export const netlog: { lines: string[] } = $state({ lines: [] });

export function note(line: string): void {
  const t = new Date().toLocaleTimeString([], { hour12: false });
  netlog.lines = [...netlog.lines, `${t} ${line}`].slice(-60);
}

/** host = a local address (".local" when the browser hides it), srflx = the public address via STUN, relay = a TURN relay. */
export function kind(c: RTCIceCandidate): string {
  return `${c.type ?? '?'}${c.address?.endsWith('.local') ? '(mdns)' : ''}/${c.protocol ?? '?'}`;
}

/** Logs a connection's ICE steps under a label, and the winning path once connected. */
export function watchIce(pc: RTCPeerConnection | undefined, label: string): void {
  if (!pc) return note(`${label}: no peer connection`);
  const seen = new Set<string>();
  pc.addEventListener('icecandidate', (e) => {
    if (!e.candidate) return note(`${label}: our candidates: ${[...seen].join(', ') || 'none'}`);
    seen.add(kind(e.candidate));
  });
  pc.addEventListener('icecandidateerror', (e) => note(`${label}: STUN error ${(e as RTCPeerConnectionIceErrorEvent).errorCode} ${(e as RTCPeerConnectionIceErrorEvent).url}`));
  pc.addEventListener('iceconnectionstatechange', () => {
    note(`${label}: ice ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') void pc.getStats().then((s) => {
      let pair: RTCIceCandidatePairStats | undefined;
      s.forEach((r) => { if (r.type === 'candidate-pair' && (r as RTCIceCandidatePairStats).nominated && (r as RTCIceCandidatePairStats).state === 'succeeded') pair = r as RTCIceCandidatePairStats; });
      const c = (id?: string) => (id ? (s.get(id) as { candidateType?: string } | undefined)?.candidateType : undefined);
      note(`${label}: path ${c(pair?.localCandidateId) ?? '?'} ↔ ${c(pair?.remoteCandidateId) ?? '?'}`);
    });
  });
}
