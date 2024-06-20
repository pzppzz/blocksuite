import { Bound } from '../../../../../../surface-block/index.js';
import { HandleDirection } from '../../../resize/resize-handles.js';
import {
  EdgelessTransformController,
  type TransformControllerContext,
} from './transform-controller.js';

export class ProportionalTransformController<
  Model extends BlockSuite.EdgelessModelType,
> extends EdgelessTransformController<Model> {
  private _getHeight: (el: Model) => number | undefined;

  override proportional = true;

  constructor(getHeight: ProportionalTransformController<Model>['_getHeight']) {
    super();
    this._getHeight = getHeight;
  }

  override onTransformStart() {}

  override onTransformEnd() {}

  override adjust(
    element: Model,
    { direction, bound, rect }: TransformControllerContext
  ) {
    const curBound = Bound.deserialize(element.xywh);
    const height = this._getHeight(element);

    if (height !== undefined) {
      rect.updateScaleDisplay(bound.h / height, direction);
    }

    if (
      direction === HandleDirection.Left ||
      direction === HandleDirection.Right
    ) {
      bound.h = (curBound.h / curBound.w) * bound.w;
    } else if (
      direction === HandleDirection.Top ||
      direction === HandleDirection.Bottom
    ) {
      bound.w = (curBound.w / curBound.h) * bound.h;
    }

    rect.edgeless.service.updateElement(element.id, {
      xywh: bound.serialize(),
    });
  }
}

export function getProportionalController<
  Model extends BlockSuite.EdgelessModelType,
>(getHeight: (el: Model) => number | undefined) {
  return new ProportionalTransformController<Model>(getHeight);
}
