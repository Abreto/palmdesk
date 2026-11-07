import 'vite/client';

declare global {
  /** The package.json version, defined at build time. */
  const TENORI_VERSION: string;
}
