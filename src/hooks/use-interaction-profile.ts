import { computed, ref } from 'vue';

import {
  interactionProfile,
  parseInteractionMode,
  type InteractionMode,
} from '@/utils/controller-input';

const STORAGE_KEY = 'palmdesk-interaction-mode-v1';

function mediaQuery(query: string) {
  const list =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(query)
      : undefined;
  const matches = ref(Boolean(list?.matches));
  // Plugging in a mouse or detaching a tablet keyboard changes these.
  list?.addEventListener?.('change', (event) => {
    matches.value = event.matches;
  });
  return matches;
}

function createInteractionProfile() {
  const mode = ref<InteractionMode>('auto');
  try {
    mode.value = parseInteractionMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    // Unavailable storage falls back to choosing from the input devices.
  }
  const finePointer = mediaQuery('(pointer: fine)');
  const hover = mediaQuery('(hover: hover)');
  const profile = computed(() =>
    interactionProfile(mode.value, {
      finePointer: finePointer.value,
      hover: hover.value,
    })
  );
  function setMode(value: unknown) {
    mode.value = parseInteractionMode(value);
    try {
      if (mode.value === 'auto') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, mode.value);
    } catch {
      // The choice still applies until this page is closed.
    }
  }
  return { mode, profile, setMode };
}

let shared: ReturnType<typeof createInteractionProfile> | undefined;

// The controller header and viewport share one choice for the page.
export function useInteractionProfile() {
  shared ||= createInteractionProfile();
  return shared;
}
