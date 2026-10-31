<script lang="ts">
  import { session } from '../../lib/sync/session.svelte.ts';

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
  </a></span>
{/if}

<style>
  .chip {
    font-size: 0.8rem;
    padding: 0.15rem 0.6rem;
    border: 1px solid var(--accent);
    border-radius: 1rem;
    text-decoration: none;
    white-space: nowrap;
  }

  .bad {
    border-color: var(--muted);
    color: var(--muted);
  }
</style>
