import type {
  Bound,
  PointLocation,
} from '../../../../../../surface-block/index.js';
import type { HandleDirection } from '../../../resize/resize-handles.js';
import type { EdgelessSelectedRect } from '../edgeless-selected-rect.js';

export type TransformControllerContext = {
  direction: HandleDirection;
  bound: Bound;
  rect: EdgelessSelectedRect;
  path?: PointLocation[];
  matrix?: DOMMatrix;
  shiftKey: boolean;
};

export abstract class EdgelessTransformController<
  Model extends BlockSuite.EdgelessModelType,
> {
  readonly rotatable: boolean = false;

  readonly proportional: boolean = false;

  readonly useAutoComplete: boolean = false;

  abstract onTransformStart(
    element: Model,
    data: TransformControllerContext
  ): void;
  abstract onTransformEnd(
    element: Model,
    data: TransformControllerContext
  ): void;

  abstract adjust(element: Model, data: TransformControllerContext): void;
  // if defined then then rotate behavior is overridden
  rotate?: (element: Model, data: TransformControllerContext) => void;
}

export type EdgelessModelConstructor<
  Model extends BlockSuite.EdgelessModelType = BlockSuite.EdgelessModelType,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
> = { new (...args: any[]): Model };

export class EdgelessTransformableRegistry {
  private static _registry = new WeakMap<
    EdgelessModelConstructor,
    EdgelessTransformController<BlockSuite.EdgelessModelType> | null
  >();

  private constructor() {}

  static register<Model extends BlockSuite.EdgelessModelType>(
    cstr: EdgelessModelConstructor<Model>,
    controller: EdgelessTransformController<Model>
  ) {
    this._registry.set(
      cstr,
      controller as EdgelessTransformController<BlockSuite.EdgelessModelType>
    );
  }

  static get(
    model: BlockSuite.EdgelessModelType
  ): EdgelessTransformController<BlockSuite.EdgelessModelType> | null {
    const cstr = model.constructor as EdgelessModelConstructor;

    // if cache is null then the controller is not registered
    // if cache is undefined then we have'nt checked it yet
    // else return the cache
    const cache = this._registry.get(cstr);
    if (cache !== undefined) return cache;

    let currentCstr = cstr;
    while (currentCstr) {
      const controller = this._registry.get(currentCstr);
      if (controller) {
        this._registry.set(cstr, controller);
        return controller;
      }
      currentCstr = Object.getPrototypeOf(currentCstr).constructor;
    }

    // a controller for this the given model is not registered
    this._registry.set(cstr, null);
    return null;
  }
}
