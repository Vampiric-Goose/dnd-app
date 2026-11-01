<script lang="ts">
  import { session } from '../../lib/sync/session.svelte.ts';
  import RetryNow from './RetryNow.svelte';

  const online = $derived(Object.keys(session.online).length);
  const text = $derived.by(() => {
    switch (session.status) {
      case 'starting': return 'Starting to host…';
      case 'hosting': return `Hosting · ${online} online`;
      case 'retrying': return 'Hosting · reconnecting…';
      case 'connecting': return 'Connecting…';
      case 'online': {
        const p = session.packs;
        return p && p.done < p.total ? `Online · books ${p.done}/${p.total}` : 'Online';
      }
      case 'offline': return 'Offline · retrying';
      case 'rejected': return 'Disconnected';
      default: return '';
    }
  });
  const reasons: Record<string, string> = {
    'code changed': 'The DM issued a new join code. Ask them for the new link.',
    removed: 'The DM removed you from this campaign.',
    'wrong code': 'That join code is not in use any more.',
    'unknown player': 'The DM does not know that player ID.',
  };
  const title = $derived(reasons[session.reason] ?? session.reason);
</script>

{#if text}
  <span role="status"><a class="chip" class:bad={session.status === 'rejected' || session.status === 'offline' || session.status === 'retrying'} href={session.role === 'dm' ? '#/settings' : '#/characters'} title={title || undefined}>
    {text}{#if session.status === 'rejected' && title}<span class="sr-only">: {title}</span>{/if}
  </a>{#if session.status === 'retrying' || session.status === 'offline'} <RetryNow compact />{/if}</span>
{/if}

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
    padding: 0.1rem 0.6rem;
    border: 1px solid var(--line-strong);
    border-radius: 99px;
    color: var(--text);
    text-decoration: none;
    white-space: nowrap;
  }

  /* status dot: teal when connected, muted while not */
  .chip::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }

  .bad {
    color: var(--muted);
  }

  .bad::before {
    background: var(--danger);
  }
</style>
