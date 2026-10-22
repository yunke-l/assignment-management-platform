import { Button, SelectField, TextAreaField } from './Controls';
import { FileButton, Modal, Progress, Slider } from '@mantine/core';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { mediaLimits, type AssetView, type Content, type InlineContent } from '@amp/contracts';
import { request, useResource } from './api';
import { useWorkGuard } from './WorkProtection';

export function useAsset(id: string, token: string) {
  const [state, setState] = useState<{ data: AssetView | null; error: string }>({
    data: null,
    error: '',
  });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const data = await request<AssetView>(`/assets/${id}`, token, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setState({ data, error: '' });
        if (data.status === 'UPLOADING' || data.status === 'PROCESSING')
          timer = setTimeout(() => void load(), 2500);
      } catch (error) {
        if (!controller.signal.aborted) setState({ data: null, error: (error as Error).message });
      }
    }
    void load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [id, token, attempt]);
  return { ...state, retry: () => retry((value) => value + 1) };
}
function ImageViewer({ id, alt }: { id: string; alt: string }) {
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  return (
    <>
      <Button
        type="button"
        className="media-image-button"
        aria-label={`Enlarge ${alt}`}
        onClick={() => setOpened(true)}
      >
        <img
          key={retry}
          loading="lazy"
          src={`/api/assets/${id}/content`}
          alt={alt}
          onError={() => setError(true)}
        />
      </Button>
      {error && (
        <p role="alert">
          Image could not load.{' '}
          <Button
            type="button"
            onClick={() => {
              setError(false);
              setRetry(retry + 1);
            }}
          >
            Retry image
          </Button>
        </p>
      )}
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={alt}
        size="auto"
        centered
        closeButtonProps={{ 'aria-label': 'Close image' }}
        classNames={{ body: 'image-viewer' }}
      >
        <img src={`/api/assets/${id}/content`} alt={alt} />
      </Modal>
    </>
  );
}
function AudioPlayer({ id, label }: { id: string; label: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const time = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  return (
    <div className="audio-player">
      <span>{label}</span>
      <audio
        ref={audio}
        preload="none"
        hidden
        aria-label={label}
        src={`/api/assets/${id}/content`}
        onError={() => setError(true)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onDurationChange={(e) =>
          setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)
        }
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onPlay={() => {
          setError(false);
          setPlaying(true);
          document.querySelectorAll('audio').forEach((other) => {
            if (other !== audio.current) other.pause();
          });
        }}
      />
      <div className="audio-controls">
        <Button
          type="button"
          className="audio-play"
          aria-label={`${playing ? 'Pause' : 'Play'} ${label}`}
          onClick={() => {
            if (playing) audio.current?.pause();
            else void audio.current?.play().catch(() => setError(true));
          }}
        >
          <MediaIcon kind={playing ? 'pause' : 'play'} />
        </Button>
        <Slider
          thumbLabel={`Seek ${label}`}
          min={0}
          max={duration || 1}
          step={0.1}
          value={position}
          disabled={!duration}
          label={time}
          onChange={(value) => {
            setPosition(value);
            if (audio.current) audio.current.currentTime = value;
          }}
        />
        <span className="audio-time">
          {time(position)} / {time(duration)}
        </span>
        <Button
          type="button"
          className="audio-mute"
          aria-label={`${muted ? 'Unmute' : 'Mute'} ${label}`}
          aria-pressed={muted}
          onClick={() => {
            if (audio.current) audio.current.muted = !muted;
            setMuted(!muted);
          }}
        >
          <MediaIcon kind={muted ? 'muted' : 'volume'} />
        </Button>
      </div>
      <div className="audio-settings">
        <label>
          Playback speed{' '}
          <SelectField
            aria-label="Playback speed"
            defaultValue="1"
            onChange={(selectedValue) => {
              if (audio.current) audio.current.playbackRate = Number(selectedValue);
            }}
          >
            {[0.75, 1, 1.25, 1.5].map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </SelectField>
        </label>
        <div className="audio-volume">
          <span>Volume</span>
          <Slider
            thumbLabel={`Volume for ${label}`}
            value={volume}
            min={0}
            max={100}
            label={(value) => `${value}%`}
            onChange={(value) => {
              setVolume(value);
              if (audio.current) audio.current.volume = value / 100;
            }}
          />
        </div>
      </div>
      {error && (
        <p role="alert">
          Audio could not load.{' '}
          <Button
            type="button"
            onClick={() => {
              setError(false);
              audio.current?.load();
            }}
          >
            Retry audio
          </Button>
        </p>
      )}
    </div>
  );
}
export function AssetPreview({
  id,
  token,
  label,
  alt,
  original = false,
  onStatus,
  caption,
  onCaption,
}: {
  id: string;
  token: string;
  label: string;
  alt?: string;
  original?: boolean;
  onStatus?: (id: string, asset: AssetView | null) => void;
  caption?: string;
  onCaption?: (value: string) => void;
}) {
  const asset = useAsset(id, token);
  useEffect(() => {
    onStatus?.(id, asset.data);
  }, [id, asset.data, onStatus]);
  if (asset.error)
    return (
      <p className="error" role="alert">
        {asset.error}{' '}
        <Button type="button" onClick={asset.retry}>
          Retry file status
        </Button>
      </p>
    );
  if (!asset.data) return <p role="status">Loading file status…</p>;
  if (asset.data.status !== 'READY')
    return (
      <p role={asset.data.status === 'FAILED' ? 'alert' : 'status'}>
        {asset.data.status === 'PROCESSING'
          ? 'Processing file…'
          : asset.data.status === 'UPLOADING'
            ? 'Upload pending. If interrupted, remove it and reselect the file.'
            : (asset.data.errorMessage ?? 'File is unavailable.')}
      </p>
    );
  return (
    <div className="asset-preview">
      {asset.data.kind === 'image' ? (
        <ImageViewer id={id} alt={alt || label} />
      ) : (
        <AudioPlayer id={id} label={label} />
      )}
      {onCaption ? (
        <label>
          Attachment description
          <TextAreaField
            aria-label="Attachment description"
            value={caption ?? asset.data.caption}
            maxLength={500}
            onChange={(e) => onCaption(e.target.value)}
          />
          <small>{[...(caption ?? asset.data.caption)].length} / 500 characters</small>
        </label>
      ) : (
        asset.data.caption && <p>{asset.data.caption}</p>
      )}
      {original && <a href={`/api/assets/${id}/content?variant=original`}>Download original</a>}
    </div>
  );
}
export function ContentView({
  content,
  token,
  blank,
}: {
  content: Content;
  token: string;
  blank?: (id: string) => ReactNode;
}) {
  const inlines = (values: InlineContent[]) =>
    values.map((node, index) => {
      if (node.type === 'blank')
        return (
          <span className="inline-blank" key={node.blankId}>
            {blank ? blank(node.blankId) : '[blank]'}
          </span>
        );
      let value: ReactNode = node.text;
      if (node.bold) value = <strong>{value}</strong>;
      if (node.italic) value = <em>{value}</em>;
      return <span key={index}>{value}</span>;
    });
  return (
    <div className="content-view">
      {content.map((block) => {
        if (block.type === 'paragraph') return <p key={block.id}>{inlines(block.children)}</p>;
        if (block.type === 'heading')
          return block.level === 2 ? (
            <h3 key={block.id}>{inlines(block.children)}</h3>
          ) : (
            <h4 key={block.id}>{inlines(block.children)}</h4>
          );
        if (block.type === 'list') {
          const items = block.items.map((row, i) => <li key={i}>{inlines(row)}</li>);
          return block.ordered ? <ol key={block.id}>{items}</ol> : <ul key={block.id}>{items}</ul>;
        }
        return (
          <figure key={block.id}>
            <AssetPreview
              id={block.assetId}
              token={token}
              label={block.label}
              alt={block.type === 'image' ? block.alt : undefined}
            />
            {block.caption && <figcaption>{block.caption}</figcaption>}
          </figure>
        );
      })}
    </div>
  );
}
export type UploadContext = {
  assignmentId: string;
  questionId: string;
  contentNodeId: string | null;
  purpose: 'TEACHING' | 'ANSWER';
};
export function TeachingCapacity({
  assignmentId,
  token,
  assetIds,
}: {
  assignmentId: string;
  token: string;
  assetIds: string[];
}) {
  const key = [...assetIds].sort().join(','),
    [state, setState] = useState<{ bytes: number; known: number; error: string }>({
      bytes: 0,
      known: 0,
      error: '',
    });
  useEffect(() => {
    const controller = new AbortController(),
      ids = new Set(key ? key.split(',') : []);
    request<AssetView[]>(`/assets?assignmentId=${assignmentId}`, token, {
      signal: controller.signal,
    }).then(
      (files) => {
        if (!controller.signal.aborted)
          setState({
            bytes: files
              .filter((file) => ids.has(file.id))
              .reduce((sum, file) => sum + file.bytes, 0),
            known: files.filter((file) => ids.has(file.id)).length,
            error: '',
          });
      },
      (error) => {
        if (!controller.signal.aborted) setState({ bytes: 0, known: 0, error: error.message });
      },
    );
    return () => controller.abort();
  }, [key, assignmentId, token]);
  return (
    <p role="status" className={state.bytes > mediaLimits.teachingBytes ? 'error' : 'footnote'}>
      Teaching media: {assetIds.length}/100 distinct files · {(state.bytes / 1048576).toFixed(2)}
      /300 MiB · {Math.max(0, (mediaLimits.teachingBytes - state.bytes) / 1048576).toFixed(2)} MiB
      remaining
      {state.known !== assetIds.length &&
        ' · Some file metadata is unavailable; saving rechecks all references.'}
      {state.error && ` · ${state.error}`}
    </p>
  );
}
export function UploadWorkspace({ assignmentId, token }: { assignmentId: string; token: string }) {
  const [revision, setRevision] = useState(0),
    [error, setError] = useState('');
  const workspace = useResource<(AssetView & { bound: boolean })[]>(
    `/assets?assignmentId=${assignmentId}`,
    token,
    revision,
  );
  return (
    <details className="upload-workspace">
      <summary>Manage temporary uploads</summary>
      <p>
        Removing an unbound server file frees temporary workspace capacity. Remove draft references
        and save before clearing a referenced teaching file. Published or submitted files are
        protected.
      </p>
      <Button type="button" onClick={() => setRevision((v) => v + 1)}>
        Refresh uploads
      </Button>
      {workspace.error && <p role="alert">{workspace.error}</p>}
      {error && <p role="alert">{error}</p>}
      {workspace.data?.map((file, i) => (
        <div key={file.id} className="temporary-file">
          <span>
            {file.originalName || `${file.kind} ${i + 1}`} · {(file.bytes / 1048576).toFixed(2)} MiB
            · {file.status} {file.bound && '· Bound'}
          </span>
          <Button
            type="button"
            disabled={file.bound}
            onClick={async () => {
              setError('');
              try {
                await request(`/assets/${file.id}`, token, { method: 'DELETE' });
                setRevision((v) => v + 1);
              } catch (reason) {
                setError((reason as Error).message);
              }
            }}
          >
            Clear server file {i + 1}
          </Button>
        </div>
      ))}
    </details>
  );
}
export function FileUpload({
  token,
  context,
  kind,
  disabled = false,
  maxBytes,
  onAsset,
  onRemove,
  onBusy,
  validateFile,
}: {
  token: string;
  context: UploadContext | null;
  kind: 'image' | 'audio';
  disabled?: boolean;
  maxBytes?: number;
  onAsset: (id: string, nodeId: string | null) => void;
  onRemove: (id: string) => void;
  onBusy?: (key: string, busy: boolean) => void;
  validateFile?: (file: File) => string | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  const transfer = useRef<XMLHttpRequest | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const transferVersion = useRef(0);
  const uploadId = useId();
  const busyKey = `${context?.questionId}:${context?.contentNodeId}:${kind}:${uploadId}`;
  useEffect(() => {
    onBusy?.(busyKey, progress !== null);
    return () => onBusy?.(busyKey, false);
  }, [busyKey, progress, onBusy]);
  useWorkGuard(`upload:${uploadId}`, progress !== null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      transfer.current?.abort();
    };
  }, []);
  async function send(selected: File) {
    if (!context || progress !== null) return;
    const version = ++transferVersion.current;
    setFile(selected);
    setError('');
    const capacityError = validateFile?.(selected);
    if (capacityError) {
      setError(capacityError);
      return;
    }
    if (maxBytes && selected.size > maxBytes) {
      setError(`This file exceeds ${Math.round((maxBytes / 1048576) * 100) / 100} MiB.`);
      return;
    }
    setProgress(0);
    let id: string | undefined;
    try {
      const extension = selected.name.split('.').at(-1)?.toLowerCase();
      const fallback: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        m4a: 'audio/mp4',
      };
      const mime = selected.type || fallback[extension ?? ''] || 'application/octet-stream';
      const nodeId = context.purpose === 'TEACHING' ? crypto.randomUUID() : null;
      const asset = await request<AssetView & { uploadUrl: string }>('/assets/uploads', token, {
        method: 'POST',
        body: JSON.stringify({
          ...context,
          contentNodeId: nodeId,
          kind,
          uploadRequestId: crypto.randomUUID(),
          name: selected.name,
          mime,
          bytes: selected.size,
        }),
      });
      id = asset.id;
      if (!alive.current || version !== transferVersion.current) {
        await request(`/assets/${id}`, token, { method: 'DELETE' });
        return;
      }
      setCurrent(id);
      onAsset(id, nodeId);
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        transfer.current = xhr;
        xhr.open('POST', asset.uploadUrl);
        xhr.withCredentials = true;
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.upload.onprogress = (event) => {
          if (alive.current && version === transferVersion.current && event.lengthComputable)
            setProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () => {
          if (version === transferVersion.current) transfer.current = null;
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            if (xhr.status === 401) window.dispatchEvent(new Event('session-expired'));
            let message = `Upload failed (${xhr.status}).`;
            try {
              message = JSON.parse(xhr.responseText).message ?? message;
            } catch {
              /* Keep status. */
            }
            reject(new Error(message));
          }
        };
        xhr.onerror = () => reject(new Error('Upload connection failed. Retry this file.'));
        xhr.onabort = () => reject(new Error('Upload cancelled.'));
        const body = new FormData();
        body.append('file', selected, selected.name);
        xhr.send(body);
      });
      if (alive.current && version === transferVersion.current) {
        setFile(null);
        setCurrent(null);
        if (input.current) input.current.value = '';
      }
    } catch (reason) {
      if (alive.current && version === transferVersion.current) {
        setError((reason as Error).message);
        if (id) onRemove(id);
      }
      if (id) await request(`/assets/${id}`, token, { method: 'DELETE' }).catch(() => {});
    } finally {
      if (alive.current && version === transferVersion.current) {
        setProgress(null);
        transfer.current = null;
      }
    }
  }
  return (
    <div className="file-upload">
      <div className="upload-picker">
        <span className="upload-kind">{kind === 'image' ? 'Image' : 'Audio'} file</span>
        <FileButton
          ref={input}
          accept={kind === 'image' ? '.jpg,.jpeg,.png,.webp' : '.mp3,.wav,.m4a'}
          disabled={disabled || !context || progress !== null}
          inputProps={{
            'aria-label': `Upload ${kind}`,
            disabled: disabled || !context || progress !== null,
            onClick: (event) => {
              event.currentTarget.value = '';
            },
          }}
          onChange={(selected) => {
            if (selected) void send(selected);
          }}
        >
          {(props) => (
            <Button
              {...props}
              type="button"
              className="upload-button"
              disabled={disabled || !context || progress !== null}
            >
              <MediaIcon kind="upload" />
              {progress !== null ? 'Uploading…' : `Upload ${kind}`}
            </Button>
          )}
        </FileButton>
        <small>
          {kind === 'image' ? 'JPG, PNG or WebP' : 'MP3, WAV or M4A'}
          {maxBytes ? ` · Up to ${Math.round((maxBytes / 1048576) * 100) / 100} MiB` : ''}
        </small>
      </div>
      {!context && <small>Save the draft first to enable uploads.</small>}
      {progress !== null && (
        <div role="status">
          {file?.name} · {file && (file.size / 1048576).toFixed(2)} MiB · Uploading {progress}%{' '}
          <Progress
            value={progress}
            aria-label={`Upload ${kind} progress`}
            aria-valuenow={progress}
          />
          <Button
            type="button"
            onClick={() => {
              transferVersion.current++;
              transfer.current?.abort();
              transfer.current = null;
              setProgress(null);
              setCurrent(null);
              setFile(null);
              setError('Upload cancelled.');
              if (input.current) input.current.value = '';
              if (current) {
                onRemove(current);
                void request(`/assets/${current}`, token, { method: 'DELETE' }).catch(() => {});
              }
            }}
          >
            Cancel upload
          </Button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}{' '}
          {file && (
            <Button type="button" disabled={progress !== null} onClick={() => void send(file)}>
              Retry upload
            </Button>
          )}
        </p>
      )}
    </div>
  );
}

function MediaIcon({ kind }: { kind: 'upload' | 'play' | 'pause' | 'volume' | 'muted' }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'upload' ? (
        <path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
      ) : kind === 'play' ? (
        <path d="m9 5 11 7-11 7Z" fill="currentColor" />
      ) : kind === 'pause' ? (
        <path d="M8 5v14M16 5v14" strokeWidth="4" />
      ) : (
        <>
          <path d="m11 4-6 5H2v6h3l6 5Z" />
          {kind === 'muted' ? (
            <path d="m17 9 5 6m0-6-5 6" />
          ) : (
            <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
          )}
        </>
      )}
    </svg>
  );
}
