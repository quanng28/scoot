/** Owns tracks even when permission resolves after cancellation. */
export class Camera {
  private epoch = 0;
  private stream: MediaStream | null = null;
  constructor(private readonly devices: Pick<MediaDevices, 'getUserMedia'>) {}
  async open(facingMode: 'user' | 'environment'): Promise<MediaStream> {
    this.stop();
    const epoch = this.epoch;
    const stream = await this.devices.getUserMedia({ audio: false, video: { facingMode: { ideal: facingMode }, width: { ideal: 640 }, height: { ideal: 480 } } });
    if (epoch !== this.epoch) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('Camera start canceled');
    }
    this.stream = stream;
    return stream;
  }
  stop(): void {
    this.epoch++;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
