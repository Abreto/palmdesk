import 'vite/client';

declare global {
  /** The package.json version, defined at build time. */
  const PALMDESK_VERSION: string;
}
