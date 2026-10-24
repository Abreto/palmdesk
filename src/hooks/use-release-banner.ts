import { computed, ref } from 'vue';

import type { IReleaseStatus } from '@/pure-interface';

const DISMISSED_KEY = 'palmdesk-release-dismissed';

function readDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) || '';
  } catch {
    return '';
  }
}

// The newest release unless the user dismissed it. A dismissed release stays
// hidden after restarts, unless it fixes security issues.
export const useReleaseBanner = (status: () => IReleaseStatus | undefined) => {
  const dismissed = ref(readDismissed());
  const latest = computed(() => {
    const release = status();
    return release?.available && release.latest?.version !== dismissed.value
      ? release.latest
      : undefined;
  });

  function dismiss() {
    // latest depends on dismissed, so read it before hiding the banner.
    const release = latest.value;
    if (!release) return;
    dismissed.value = release.version;
    if (release.security) return;
    try {
      localStorage.setItem(DISMISSED_KEY, release.version);
    } catch {
      // Without storage the banner returns on the next launch.
    }
  }

  return { latest, dismiss };
};
