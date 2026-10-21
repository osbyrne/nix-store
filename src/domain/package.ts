export type Manager = 'nix' | 'brew-formula' | 'brew-cask';
export type DarwinPlatform = 'aarch64-darwin' | 'x86_64-darwin';
export interface PackageSource {
  readonly manager: Manager;
  readonly identifier: string;
  readonly version: string;
  readonly platforms: readonly DarwinPlatform[];
  readonly needsAdmin?: boolean;
  readonly appName?: string;
}
export interface Package {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: 'gui' | 'cli';
  readonly sources: readonly PackageSource[];
  readonly icon?: string;
  readonly homepage?: string;
  readonly installed?: readonly { readonly manager: Manager; readonly version: string }[];
}
/** argv stays structured through planning and execution. */
export interface InstallPlan {
  readonly packageId: string;
  readonly source: PackageSource;
  readonly steps: readonly { readonly executable: string; readonly args: readonly string[] }[];
  readonly warnings: readonly string[];
}
export type OperationState = 'queued' | 'running' | 'needs-admin' | 'succeeded' | 'failed' | 'cancelled';
