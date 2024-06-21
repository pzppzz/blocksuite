import type {
  BlockElement,
  EditorHost,
  TextRangePoint,
  TextSelection,
} from '@blocksuite/block-std';
import { assertExists } from '@blocksuite/global/utils';
import type { Text } from '@blocksuite/store';
import {
  type BlockModel,
  type BlockSnapshot,
  type DeltaOperation,
  DocCollection,
  fromJSON,
  type JobMiddleware,
  type SliceSnapshot,
} from '@blocksuite/store';

import { matchFlavours } from '../../../_common/utils/index.js';
import type { CodeBlockModel } from '../../../code-block/index.js';
import type { ParagraphBlockModel } from '../../../paragraph-block/index.js';
import { transformModel } from '../../utils/operations/model.js';

const findLast = (snapshot: BlockSnapshot): BlockSnapshot => {
  if (snapshot.children && snapshot.children.length > 0) {
    return findLast(snapshot.children[snapshot.children.length - 1]);
  }
  return snapshot;
};

class PointState {
  readonly block: BlockElement;

  readonly text: Text;

  readonly model: BlockModel;

  constructor(
    readonly std: EditorHost['std'],
    readonly point: TextRangePoint
  ) {
    this.block = this._blockFromPath(point.blockId);
    this.model = this.block.model;
    const text = this.model.text;
    assertExists(text);
    this.text = text;
  }

  private _blockFromPath = (path: string) => {
    const block = this.std.view.getBlock(path);
    assertExists(block);
    return block;
  };
}

class PasteTr {
  private readonly lastIndex: number;

  private readonly fromPointState: PointState;

  private readonly endPointState: PointState;

  private readonly to: TextRangePoint | null;

  private readonly firstSnapshot: BlockSnapshot;

  private lastSnapshot: BlockSnapshot;

  private readonly firstSnapshotIsPlainText: boolean;

  // The model that the cursor should focus on after pasting
  private pasteStartModel: BlockModel | null = null;

  constructor(
    readonly std: EditorHost['std'],
    readonly text: TextSelection,
    readonly snapshot: SliceSnapshot
  ) {
    const { from, to } = text;
    const end = to ?? from;

    this.to = to;

    this.fromPointState = new PointState(std, from);
    this.endPointState = new PointState(std, end);

    this.firstSnapshot = snapshot.content[0];
    this.lastSnapshot = findLast(snapshot.content[snapshot.content.length - 1]);
    if (matchFlavours(this.fromPointState.model, ['affine:code'])) {
      this.lastIndex =
        this.fromPointState.point.index +
        this.snapshot.content
          .map(snapshot =>
            this._textFromSnapshot(snapshot)
              .delta.map(op => {
                if (op.insert) {
                  return op.insert.length;
                } else if (op.delete) {
                  return -op.delete;
                } else {
                  return 0;
                }
              })
              .reduce((a, b) => a + b, 0)
          )
          .reduce((a, b) => a + b + 1, -1);
    } else if (
      this.firstSnapshot !== this.lastSnapshot &&
      this.lastSnapshot.props.text
    ) {
      const text = fromJSON(this.lastSnapshot.props.text) as Text;
      const doc = new DocCollection.Y.Doc();
      const temp = doc.getMap('temp');
      temp.set('text', text.yText);
      this.lastIndex = text.length;
    } else {
      this.lastIndex = this.endPointState.text.length - end.index - end.length;
    }
    this.firstSnapshotIsPlainText =
      this.firstSnapshot.flavour === 'affine:paragraph' &&
      this.firstSnapshot.props.type === 'text';
  }

  private _textFromSnapshot = (snapshot: BlockSnapshot) => {
    return snapshot.props.text as Record<'delta', DeltaOperation[]>;
  };

  private _getDeltas = () => {
    const firstTextSnapshot = this._textFromSnapshot(this.firstSnapshot);
    const lastTextSnapshot = this._textFromSnapshot(this.lastSnapshot);
    const fromDelta = this.fromPointState.text.sliceToDelta(
      0,
      this.fromPointState.point.index
    );
    const toDelta = this.endPointState.text.sliceToDelta(
      this.endPointState.point.index + this.endPointState.point.length,
      this.endPointState.text.length
    );
    const firstDelta = firstTextSnapshot.delta;
    const lastDelta = lastTextSnapshot.delta;
    return {
      firstTextSnapshot,
      lastTextSnapshot,
      fromDelta,
      toDelta,
      firstDelta,
      lastDelta,
    };
  };

  private _mergeCode = () => {
    const { firstTextSnapshot, fromDelta, toDelta } = this._getDeltas();

    this.firstSnapshot.flavour = this.fromPointState.model.flavour;
    const toLanguage = (this.fromPointState.model as CodeBlockModel).language;
    if (toLanguage !== 'Plain Text') {
      this.firstSnapshot.props.language = toLanguage;
    }
    const deltas: DeltaOperation[] = [...fromDelta];
    let i = 0;
    for (const blockSnapshot of this.snapshot.content) {
      if (blockSnapshot.props.text) {
        const text = this._textFromSnapshot(blockSnapshot);
        if (i > 0) {
          deltas.push({ insert: '\n' });
        }
        deltas.push(...text.delta);
        i++;
      } else {
        break;
      }
    }
    firstTextSnapshot.delta = deltas.concat(toDelta);
    this.snapshot.content.splice(1, i);
    this.lastSnapshot = findLast(
      this.snapshot.content[this.snapshot.content.length - 1]
    );
  };

  private _mergeSingle = () => {
    this.firstSnapshot.flavour = this.fromPointState.model.flavour;
    if (
      this.firstSnapshot.props.type &&
      (this.fromPointState.text.length > 0 || this.firstSnapshotIsPlainText)
    ) {
      this.firstSnapshot.props.type = (
        this.fromPointState.model as ParagraphBlockModel
      ).type;
    }
    const { firstTextSnapshot, fromDelta, toDelta, firstDelta } =
      this._getDeltas();

    firstTextSnapshot.delta = [...fromDelta, ...firstDelta, ...toDelta];
  };

  private _mergeMultiple = () => {
    this.firstSnapshot.flavour = this.fromPointState.model.flavour;
    if (
      this.firstSnapshot.props.type &&
      (this.fromPointState.text.length > 0 || this.firstSnapshotIsPlainText)
    ) {
      this.firstSnapshot.props.type = (
        this.fromPointState.model as ParagraphBlockModel
      ).type;
    }
    if (this.lastSnapshot.props.type && this.to) {
      this.lastSnapshot.flavour = this.endPointState.model.flavour;
      this.lastSnapshot.props.type = (
        this.endPointState.model as ParagraphBlockModel
      ).type;
    }

    const {
      firstTextSnapshot,
      lastTextSnapshot,
      fromDelta,
      toDelta,
      firstDelta,
      lastDelta,
    } = this._getDeltas();

    firstTextSnapshot.delta = [...fromDelta, ...firstDelta];
    lastTextSnapshot.delta = [...lastDelta, ...toDelta];
  };

  canMerge = () => {
    const firstTextSnapshot = this._textFromSnapshot(this.firstSnapshot);
    const lastTextSnapshot = this._textFromSnapshot(this.lastSnapshot);
    return (
      firstTextSnapshot &&
      lastTextSnapshot &&
      ((this.fromPointState.text.length > 0 &&
        this.endPointState.text.length > 0) ||
        this.firstSnapshotIsPlainText)
    );
  };

  pasted = () => {
    const needCleanup = this.canMerge() || this.endPointState.text.length === 0;
    if (!needCleanup) {
      return;
    }

    const firstBlock = this.std.doc.getBlock(this.firstSnapshot.id);
    assertExists(firstBlock);
    const { model: firstModel } = firstBlock;
    this.fromPointState.text?.clear();
    this.fromPointState.text?.applyDelta(firstModel.text?.toDelta() ?? []);
    if (this.fromPointState.model.flavour !== firstModel.flavour) {
      const newId = transformModel(
        this.fromPointState.model,
        firstModel.flavour as BlockSuite.Flavour
      );
      this.pasteStartModel = this.std.doc.getBlock(newId)!.model;
    } else if (this.fromPointState.model.flavour === 'affine:paragraph') {
      (this.fromPointState.model as ParagraphBlockModel).type = (
        firstModel as ParagraphBlockModel
      ).type;
      this.pasteStartModel = this.fromPointState.model;
    } else {
      this.pasteStartModel = this.fromPointState.model;
    }

    if (this.to) {
      const [_, context] = this.std.command
        .chain()
        .getSelectedModels({
          types: ['text'],
        })
        .run();
      const textModels = context.selectedModels ?? [];
      for (const model of textModels) {
        if (
          [this.fromPointState.model.id, this.endPointState.model.id].includes(
            model.id
          ) ||
          this.snapshot.content.map(block => block.id).includes(model.id)
        ) {
          continue;
        }
        this.std.doc.deleteBlock(model);
      }
      this.std.doc.deleteBlock(
        this.endPointState.model,
        this.pasteStartModel
          ? {
              bringChildrenTo: this.pasteStartModel,
            }
          : undefined
      );
    }

    const lastBlock = this.std.doc.getBlock(this.lastSnapshot.id);
    assertExists(lastBlock);
    const { model: lastModel } = lastBlock;

    this.std.doc.moveBlocks(this.pasteStartModel.children, lastModel);
    queueMicrotask(() => {
      this.std.doc.deleteBlock(firstModel, {
        bringChildrenTo: this.pasteStartModel!,
      });
    });
  };

  focusPasted = () => {
    const host = this.std.host as EditorHost;

    const cursorBlock =
      this.fromPointState.model.flavour === 'affine:code'
        ? this.std.doc.getBlock(this.fromPointState.model.id)
        : this.std.doc.getBlock(this.lastSnapshot.id);
    assertExists(cursorBlock);
    const { model: cursorModel } = cursorBlock;

    host.updateComplete
      .then(() => {
        const target = this.std.host.querySelector<BlockElement>(
          `[${host.blockIdAttr}="${cursorModel.id}"]`
        );
        assertExists(target);
        if (!cursorModel.text) {
          if (matchFlavours(cursorModel, ['affine:image'])) {
            const selection = this.std.selection.create('image', {
              blockId: target.blockId,
            });
            this.std.selection.setGroup('note', [selection]);
            return;
          }
          const selection = this.std.selection.create('block', {
            blockId: target.blockId,
          });
          this.std.selection.setGroup('note', [selection]);
          return;
        }
        if (matchFlavours(cursorModel, ['affine:code'])) {
          const selection = this.std.selection.create('text', {
            from: {
              blockId: target.blockId,
              index: this.lastIndex,
              length: 0,
            },
            to: null,
          });
          this.std.selection.setGroup('note', [selection]);
          return;
        }
        const selection = this.std.selection.create('text', {
          from: {
            blockId: target.blockId,
            index:
              this.firstSnapshot === this.lastSnapshot
                ? cursorModel.text
                  ? cursorModel.text.length - this.lastIndex
                  : 0
                : this.lastIndex,
            length: 0,
          },
          to: null,
        });
        this.std.selection.setGroup('note', [selection]);
      })
      .catch(console.error);
  };

  merge() {
    if (this.fromPointState.model.flavour === 'affine:code' && !this.to) {
      this._mergeCode();
      return;
    }

    if (this.firstSnapshot === this.lastSnapshot) {
      this._mergeSingle();
      return;
    }

    this._mergeMultiple();
  }

  convertToLinkedDoc = async (std: EditorHost['std']) => {
    const quickSearchService =
      std.spec.getService('affine:page').quickSearchService;

    if (!quickSearchService) {
      return;
    }

    const linkToDocId = new Map<string, string | null>();

    for (const blockSnapshot of this.snapshot.content) {
      if (blockSnapshot.props.text) {
        const text = this._textFromSnapshot(blockSnapshot);
        const needToConvert = new Map<DeltaOperation, string>();
        for (const op of text.delta) {
          if (op.attributes?.link) {
            let docId = linkToDocId.get(op.attributes.link);
            if (docId === undefined) {
              const searchResult = await quickSearchService.searchDoc({
                userInput: op.attributes.link,
                skipSelection: true,
                action: 'insert',
              });
              if (searchResult && 'docId' in searchResult) {
                const doc = std.collection.getDoc(searchResult.docId);
                if (doc) {
                  docId = doc.id;
                  linkToDocId.set(op.attributes.link, doc.id);
                }
              }
            }
            if (docId) {
              needToConvert.set(op, docId);
            }
          }
        }
        const delta = text.delta.map(op => {
          if (needToConvert.has(op)) {
            return {
              ...op,
              attributes: {
                reference: {
                  pageId: needToConvert.get(op),
                  type: 'LinkedPage',
                },
              },
              insert: ' ',
            };
          }
          return {
            ...op,
          };
        });
        const model = std.doc.getBlockById(blockSnapshot.id);
        if (model) {
          std.spec
            .getService('affine:page')
            .telemetryService?.track('LinkedDocCreated', {
              page: 'doc editor',
              category: 'pasted link',
              type: 'doc',
              other: 'existing doc',
            });
          std.doc.captureSync();
          std.doc.transact(() => {
            const text = model.text as Text;
            text.clear();
            text.applyDelta(delta);
          });
        }
      }
    }
  };
}

function flatNote(snapshot: SliceSnapshot) {
  if (snapshot.content[0]?.flavour === 'affine:note') {
    snapshot.content = snapshot.content[0].children;
  }
}

export const pasteMiddleware = (std: EditorHost['std']): JobMiddleware => {
  return ({ slots }) => {
    let tr: PasteTr | undefined;
    slots.beforeImport.on(payload => {
      if (payload.type === 'slice') {
        const { snapshot } = payload;
        flatNote(snapshot);

        const text = std.selection.find('text');
        if (!text) {
          return;
        }
        tr = new PasteTr(std, text, payload.snapshot);
        if (tr.canMerge()) {
          tr.merge();
        }
      }
    });
    slots.afterImport.on(payload => {
      if (tr && payload.type === 'slice') {
        tr.pasted();
        tr.focusPasted();
        tr.convertToLinkedDoc(std).catch(console.error);
      }
    });
  };
};
