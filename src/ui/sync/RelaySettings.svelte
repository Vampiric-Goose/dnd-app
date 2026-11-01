<script lang="ts">
  // This device's TURN relay: needed on networks that block direct connections (hotel and other shared Wi-Fi, some mobile data).
  import { db } from '../../lib/db.ts';
  import Drawer from '../kit/Drawer.svelte';
  import { parseRelay, RELAY_KEY, storedRelay, type Relay } from '../../lib/sync/relay.ts';

  let urls = $state(''), username = $state(''), credential = $state('');
  let saved: Relay | undefined = $state();
  let msg = $state('');
  let testing = $state(false);

  $effect(() => {
    db.meta.get(RELAY_KEY).then((v) => {
      saved = storedRelay(v);
      if (saved) ({ username, credential } = saved), (urls = saved.urls.join('\n'));
    }, () => {});
  });

  function current(): Relay | undefined {
    const r = parseRelay(urls, username, credential);
    if (typeof r === 'string') { msg = r; return undefined; }
    return r;
  }

  async function save() {
    const r = current();
    if (!r) return;
    await db.meta.set(RELAY_KEY, r);
    saved = r;
    msg = 'Saved on this device. It is used the next time you host or join (reload the page if a connection is already running).';
  }

  async function clear() {
    await db.meta.set(RELAY_KEY, null);
    saved = undefined;
    urls = username = credential = '';
    msg = 'Removed. Connections are direct only.';
  }

  /** Asks the relay for an address, the way a real connection would; works without anyone else online. */
  async function test() {
    const r = current();
    if (!r) return;
    testing = true;
    msg = 'Testing…';
    const pc = new RTCPeerConnection({ iceServers: [{ urls: r.urls, username: r.username, credential: r.credential }], iceTransportPolicy: 'relay' });
    try {
      pc.createDataChannel('test');
      const ok = new Promise<boolean>((done) => {
        const t = setTimeout(() => done(false), 10_000);
        pc.addEventListener('icecandidate', (e) => { if (e.candidate?.type === 'relay') { clearTimeout(t); done(true); } });
      });
      await pc.setLocalDescription(await pc.createOffer());
      msg = (await ok) ? 'The relay works.' : 'The relay did not answer. Check the addresses, username and password.';
    } catch {
      msg = 'The relay did not answer. Check the addresses, username and password.';
    } finally {
      pc.close();
      testing = false;
    }
  }
</script>

<Drawer title="Relay server">
  {#snippet summary()}{saved ? 'Set' : 'Optional'}{/snippet}
  <p class="muted">Hotel and other shared Wi-Fi, some mobile data, and some school or work networks block direct connections between devices. A relay (TURN) server passes the traffic along instead. Get free credentials from a TURN provider (for example metered.ca) and paste them here. They are stored only on this device. The DM setting one is usually enough; a player can add one too.</p>
  <div class="field">
    <label for="relay-urls">Server addresses (one per line)</label>
    <textarea id="relay-urls" rows="3" bind:value={urls} spellcheck="false" autocapitalize="off" placeholder="turn:relay.example.com:443?transport=tcp"></textarea>
  </div>
  <div class="field">
    <label for="relay-user">Username</label>
    <input id="relay-user" bind:value={username} autocomplete="off" autocapitalize="off" spellcheck="false" />
  </div>
  <div class="field">
    <label for="relay-pass">Password (credential)</label>
    <input id="relay-pass" type="password" bind:value={credential} autocomplete="off" />
  </div>
  <div class="row">
    <button type="button" class="primary" onclick={save}>Save</button>
    <button type="button" disabled={testing} onclick={test}>Test</button>
    {#if saved}<button type="button" class="danger end" onclick={clear}>Remove</button>{/if}
  </div>
  {#if msg}<p role="status">{msg}</p>{/if}
</Drawer>

<style>
  textarea {
    width: 100%;
    font-family: var(--mono);
    font-size: 0.9em;
  }

  .field input {
    max-width: 24rem;
  }

  .end {
    margin-left: auto;
  }
</style>
