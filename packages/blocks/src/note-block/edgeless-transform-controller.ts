import {
  EdgelessTransformableRegistry,
  EdgelessTransformController,
  type TransformControllerContext,
} from '../root-block/edgeless/components/rects/edgeless-selected-rect/index.js';
import { NoteBlockModel } from './note-model.js';

class NoteTransformController extends EdgelessTransformController<NoteBlockModel> {
  override onTransformStart(): void {}

  override onTransformEnd(): void {}

  override adjust(
    _element: NoteBlockModel,
    _data: TransformControllerContext
  ): void {
    console.log('Hello transforming note block');
  }
}

EdgelessTransformableRegistry.register(
  NoteBlockModel,
  new NoteTransformController()
);
