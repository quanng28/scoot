import type { PoseFrame } from './observations.js';

/** Standard 33-point pose connections, including both arms, legs and foot points. */
export const BODY_CONNECTIONS: readonly (readonly [number, number])[] = [
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
  [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
  [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
  [11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],
  [24,26],[26,28],[28,30],[30,32],[28,32],
];

/** Mirroring affects display/taps only; analysis remains anatomical and unmirrored. */
export function previewX(normalizedX: number, mirrored: boolean): number {
  return mirrored ? 1 - normalizedX : normalizedX;
}

export const HAND_CONNECTIONS: readonly (readonly [number, number])[] = [
  [0,1],[1,2],[2,3],[3,4], [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12], [9,13],[13,14],[14,15],[15,16],
  [13,17],[0,17],[17,18],[18,19],[19,20],
];

/** Draw only observed landmarks. Display mirroring never modifies the inference result. */
export function drawSkeleton(context: CanvasRenderingContext2D, frame: PoseFrame, mirrored: boolean): void {
  type Point = { x: number; y: number };
  const visible = (point: Point | undefined): point is Point => !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
  const x = (point: Point) => previewX(point.x, mirrored) * frame.width;
  const y = (point: Point) => point.y * frame.height;
  const body = frame.points.map((point) => visible(point) && point.visibility !== null && point.visibility >= 0.5 ? point : undefined);
  const connections = (points: readonly (Point | undefined)[], edges: readonly (readonly [number, number])[]) => {
    for (const [a, b] of edges) {
      const p = points[a], q = points[b];
      if (!visible(p) || !visible(q)) continue;
      context.beginPath(); context.moveTo(x(p), y(p)); context.lineTo(x(q), y(q)); context.stroke();
    }
  };
  const joints = (points: readonly (Point | undefined)[], radius: number) => {
    for (const point of points) {
      if (!visible(point)) continue;
      context.beginPath(); context.arc(x(point), y(point), radius, 0, Math.PI * 2); context.fill();
    }
  };
  context.save();
  context.lineCap = 'round'; context.lineJoin = 'round';
  context.strokeStyle = '#7fd1c7'; context.lineWidth = 3;
  connections(body, BODY_CONNECTIONS);
  context.fillStyle = '#f4f7f8'; joints(body, 4);
  context.strokeStyle = '#f59bd8'; context.lineWidth = 2;
  context.fillStyle = '#fff0fb';
  for (const hand of frame.hands ?? []) {
    connections(hand, HAND_CONNECTIONS);
    joints(hand, 3);
  }
  context.restore();
}
