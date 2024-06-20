import type { EdgelessTransformController } from '../index.js';

export interface EdgelessTransformable<
  Model extends BlockSuite.EdgelessModelType,
> {
  readonly transformController: EdgelessTransformController<Model>;
}
