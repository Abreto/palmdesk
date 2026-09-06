import type { ICaptureSource, IRemoteWindow } from '@/pure-interface';

// Each authenticated peer can select only identities from its latest list.
export class WindowCatalog {
  private sources = new Map<string, ICaptureSource>();

  update(sources: ICaptureSource[]): IRemoteWindow[] {
    this.sources.clear();
    return sources.map((source) => {
      const id = crypto.randomUUID();
      this.sources.set(id, { ...source });
      return {
        id,
        name: source.name.slice(0, 1024),
        appName: (source.appName || source.bundleId).slice(0, 256),
        // One result per message stays below the DataChannel message limit.
        thumbnail: source.thumbnail.length <= 40000 ? source.thumbnail : '',
        appIcon: source.appIcon.length <= 8000 ? source.appIcon : '',
        isOnScreen: source.isOnScreen,
      };
    });
  }

  get(id: string) {
    const source = this.sources.get(id);
    if (!source) throw new Error('窗口列表已更新，请刷新后重新选择');
    return source;
  }
}
