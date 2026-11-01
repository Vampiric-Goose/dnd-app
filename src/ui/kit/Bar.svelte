<!--
  Bar: a thin HP bar, role="meter". Teal for characters (tone="accent", the default), red for monsters
  (tone="danger"). `temp` adds a lighter segment for temporary HP past the fill. Pages print the numbers
  themselves (in .num). See README.md.
-->
<script lang="ts">
  let {
    value,
    max,
    label,
    tone = 'accent',
    temp = 0,
  }: {
    value: number;
    max: number;
    /** accessible name ("Goblin 2 hit points") */
    label: string;
    tone?: 'accent' | 'danger';
    temp?: number;
  } = $props();

  const pct = (n: number) => (max > 0 ? Math.max(0, Math.min(100, (n / max) * 100)) : 0);
  const fill = $derived(pct(value));
  const extra = $derived(Math.min(pct(temp), 100 - fill));
</script>

<div
  class="bar"
  role="meter"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={max}
  aria-valuenow={value}
  aria-valuetext="{value} of {max}{temp ? `, ${temp} temporary` : ''}"
>
  <i class={tone} style:width="{fill}%"></i>{#if extra > 0}<i class="temp" style:width="{extra}%"></i>{/if}
</div>

<style>
  .bar {
    display: flex;
    height: 5px;
    min-width: 3rem;
    border-radius: 3px;
    background: color-mix(in srgb, var(--raised) 70%, var(--line));
    overflow: hidden;
  }

  i {
    display: block;
    height: 100%;
    transition: width 0.2s;
  }

  .accent {
    background: var(--accent);
  }

  .danger {
    background: var(--danger);
  }

  .temp {
    background: color-mix(in srgb, var(--accent) 40%, var(--text-strong));
    opacity: 0.6;
  }
</style>
