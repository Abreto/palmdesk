export class CaptureLifecycle {
  private generation = 0;
  private stream?: MediaStream;

  stop() {
    this.generation += 1;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }

  async start(capture: () => Promise<MediaStream>) {
    this.stop();
    const generation = this.generation;
    const stream = await capture();
    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      return undefined;
    }
    this.stream = stream;
    return stream;
  }
}
