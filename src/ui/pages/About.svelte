<script lang="ts">
  import { APP_NAME, SRD_ATTRIBUTION } from '../../lib/app.ts';
  import SettingsGroup from '../SettingsGroup.svelte';
</script>

<h1>About {APP_NAME}</h1>
<SettingsGroup title="Attribution">
  <!-- The attribution text stays verbatim; its URLs become links (a trailing full stop is not part of the URL). -->
  <p class="prose">{#each SRD_ATTRIBUTION.split(/(https:\/\/\S+?)(?=\.?(?:\s|$))/) as part, i}{#if i % 2}<a href={part} target="_blank" rel="noopener noreferrer">{part}</a>{:else}{part}{/if}{/each}</p>
</SettingsGroup>
