import { InputField, TextAreaField, Button } from './Controls';
import { useState, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import {
  contentCharacterCount,
  mediaLimits,
  type Content,
  type ContentBlock,
  type InlineContent,
} from '@amp/contracts';
import { AssetPreview, FileUpload, useAsset, type UploadContext } from './Media';
import { request } from './api';

function plain(children: InlineContent[], blankIds: string[]) {
  return children
    .map((c) => (c.type === 'text' ? c.text : `[blank ${blankIds.indexOf(c.blankId) + 1}]`))
    .join('');
}
function parse(
  value: string,
  blankIds: string[],
  bold?: boolean,
  italic?: boolean,
): InlineContent[] {
  const children: InlineContent[] = [];
  let previous = 0;
  for (const match of value.matchAll(/\[blank (\d+)\]/g)) {
    const id = blankIds[Number(match[1]) - 1];
    if (!id) continue;
    if (match.index > previous)
      children.push({ type: 'text', text: value.slice(previous, match.index), bold, italic });
    children.push({ type: 'blank', blankId: id });
    previous = match.index + match[0].length;
  }
  children.push({ type: 'text', text: value.slice(previous), bold, italic });
  return children;
}
export function ContentEditor({
  content,
  onChange,
  label,
  token,
  context,
  blankIds = [],
  limit = 5000,
  compact = false,
}: {
  content: Content;
  onChange: Dispatch<SetStateAction<Content>>;
  label: string;
  token: string;
  context: UploadContext | null;
  blankIds?: string[];
  limit?: number;
  compact?: boolean;
}) {
  function update(id: string, change: (old: ContentBlock) => ContentBlock) {
    onChange((old) => old.map((block) => (block.id === id ? change(block) : block)));
  }
  function move(id: string, offset: number) {
    onChange((old) => {
      const next = [...old],
        from = next.findIndex((b) => b.id === id),
        to = from + offset;
      if (to >= 0 && to < next.length) [next[from], next[to]] = [next[to]!, next[from]!];
      return next;
    });
  }
  function addMedia(kind: 'image' | 'audio', assetId: string, nodeId: string | null) {
    onChange((old) => [
      ...old,
      kind === 'image'
        ? { id: nodeId!, type: kind, assetId, label: '', alt: '', caption: '' }
        : { id: nodeId!, type: kind, assetId, label: '', caption: '' },
    ]);
  }
  const removeAsset = (id: string) =>
    onChange((old) => old.filter((block) => !('assetId' in block) || block.assetId !== id));
  return (
    <div className="content-editor">
      {content.map((block, index) => (
        <div className="content-block-editor" key={block.id}>
          {block.type === 'image' || block.type === 'audio' ? (
            <>
              <AssetPreview
                id={block.assetId}
                token={token}
                label={block.label || 'Teaching media'}
                alt={block.type === 'image' ? block.alt : undefined}
              />
              <label>
                Public media label
                <InputField
                  value={block.label}
                  onChange={(e) =>
                    update(block.id, (old) => ({ ...old, label: e.target.value }) as ContentBlock)
                  }
                />
              </label>
              {block.type === 'image' && (
                <label>
                  Image description
                  <InputField
                    value={block.alt}
                    onChange={(e) =>
                      update(block.id, (old) => ({ ...old, alt: e.target.value }) as ContentBlock)
                    }
                  />
                </label>
              )}
              <label>
                Media caption
                <InputField
                  value={block.caption}
                  onChange={(e) =>
                    update(block.id, (old) => ({ ...old, caption: e.target.value }) as ContentBlock)
                  }
                />
              </label>
              {block.type === 'audio' && (
                <details>
                  <summary>Teacher-only transcript</summary>
                  <Transcript id={block.assetId} token={token} />
                </details>
              )}
            </>
          ) : (
            <>
              <label>
                {index === 0 ? label : `${label} · block ${index + 1}`}
                <TextAreaField
                  aria-label={index === 0 ? label : `${label} · block ${index + 1}`}
                  rows={block.type === 'list' ? Math.max(2, block.items.length) : 3}
                  value={
                    block.type === 'list'
                      ? block.items.map((row) => plain(row, blankIds)).join('\n')
                      : plain(block.children, blankIds)
                  }
                  onChange={(e) =>
                    update(block.id, (old) => {
                      if (old.type === 'image' || old.type === 'audio') return old;
                      const first = (old.type === 'list' ? old.items[0] : old.children)?.find(
                        (c) => c.type === 'text',
                      );
                      return old.type === 'list'
                        ? {
                            ...old,
                            items: e.target.value
                              .split('\n')
                              .map((row) => parse(row, blankIds, first?.bold, first?.italic)),
                          }
                        : {
                            ...old,
                            children: parse(e.target.value, blankIds, first?.bold, first?.italic),
                          };
                    })
                  }
                />
              </label>
            </>
          )}
          <EditorTools compact={compact} title="Formatting & block options">
            {block.type !== 'image' && block.type !== 'audio' && (
              <div className="inline-actions">
                {(['bold', 'italic'] as const).map((mark) => (
                  <Button
                    type="button"
                    key={mark}
                    onClick={() =>
                      update(block.id, (old) => {
                        if (old.type === 'image' || old.type === 'audio') return old;
                        const change = (row: InlineContent[]) => {
                          const enabled = !row.some((n) => n.type === 'text' && n[mark]);
                          return row.map((n) =>
                            n.type === 'text' ? { ...n, [mark]: enabled } : n,
                          );
                        };
                        return old.type === 'list'
                          ? { ...old, items: old.items.map(change) }
                          : { ...old, children: change(old.children) };
                      })
                    }
                  >
                    {mark === 'bold' ? 'Bold' : 'Italic'}
                  </Button>
                ))}
              </div>
            )}
            <div className="inline-actions">
              <Button
                type="button"
                disabled={!index}
                aria-label={`Move content block ${index + 1} up`}
                onClick={() => move(block.id, -1)}
              >
                ↑
              </Button>
              <Button
                type="button"
                disabled={index === content.length - 1}
                aria-label={`Move content block ${index + 1} down`}
                onClick={() => move(block.id, 1)}
              >
                ↓
              </Button>
              <Button
                type="button"
                onClick={() => onChange((old) => old.filter((b) => b.id !== block.id))}
              >
                Remove content block
              </Button>
            </div>
          </EditorTools>
        </div>
      ))}
      <EditorTools compact={compact} title="Add media or more text">
        <div className="inline-actions">
          <Button
            type="button"
            onClick={() =>
              onChange((old) => [
                ...old,
                {
                  id: crypto.randomUUID(),
                  type: 'paragraph',
                  children: [{ type: 'text', text: '' }],
                },
              ])
            }
          >
            Add paragraph
          </Button>
          <Button
            type="button"
            onClick={() =>
              onChange((old) => [
                ...old,
                {
                  id: crypto.randomUUID(),
                  type: 'heading',
                  level: 2,
                  children: [{ type: 'text', text: '' }],
                },
              ])
            }
          >
            Add heading
          </Button>
          <Button
            type="button"
            onClick={() =>
              onChange((old) => [
                ...old,
                {
                  id: crypto.randomUUID(),
                  type: 'list',
                  ordered: false,
                  items: [[{ type: 'text', text: '' }]],
                },
              ])
            }
          >
            Add list
          </Button>
        </div>
        <small>
          {content.filter((b) => b.type === 'image').length}/10 images ·{' '}
          {content.filter((b) => b.type === 'audio').length}/5 audio files at this location
        </small>
        <small className={contentCharacterCount(content) > limit ? 'error' : 'muted'}>
          {contentCharacterCount(content)} / {limit} characters. Media labels must not reveal
          answers.
        </small>
        <div className="media-upload-row">
          {(['image', 'audio'] as const).map((kind) => (
            <FileUpload
              key={kind}
              token={token}
              context={context}
              kind={kind}
              disabled={
                content.filter((block) => block.type === kind).length >= (kind === 'image' ? 10 : 5)
              }
              maxBytes={kind === 'image' ? mediaLimits.imageBytes : mediaLimits.audioBytes}
              onAsset={(id, nodeId) => addMedia(kind, id, nodeId)}
              onRemove={removeAsset}
            />
          ))}
        </div>
      </EditorTools>
    </div>
  );
}

function EditorTools({
  compact,
  title,
  children,
}: {
  compact: boolean;
  title: string;
  children: ReactNode;
}) {
  return compact ? (
    <details
      className="editor-tools"
      onChangeCapture={(event) => {
        if (event.target instanceof HTMLInputElement && event.target.type === 'file')
          event.currentTarget.open = true;
      }}
    >
      <summary>{title}</summary>
      {children}
    </details>
  ) : (
    <>{children}</>
  );
}

function Transcript({ id, token }: { id: string; token: string }) {
  const meta = useAsset(id, token);
  const [text, setText] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div>
      <label>
        Private transcript
        <TextAreaField
          aria-label="Private transcript"
          value={text ?? meta.data?.transcript ?? ''}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <Button
        type="button"
        disabled={busy || text === null}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await request(`/assets/${id}`, token, {
              method: 'PATCH',
              body: JSON.stringify({ transcript: text }),
            });
            meta.retry();
            setText(null);
          } catch (reason) {
            setError((reason as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Save private transcript
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
