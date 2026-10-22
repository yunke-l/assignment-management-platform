import { createReadStream } from 'node:fs';
import { readFile, stat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import sharp from 'sharp';
import { mediaLimits } from '@amp/contracts';

sharp.cache(false);
sharp.concurrency(1);

export class MediaError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 422,
  ) {
    super(code);
  }
}
export function sourceFormat(name: string, mime: string, kind: 'image' | 'audio') {
  const extension = name.split('.').at(-1)?.toLowerCase();
  const formats: Record<string, { mime: string[]; kind: string; format: string }> = {
    jpg: { mime: ['image/jpeg'], kind: 'image', format: 'jpeg' },
    jpeg: { mime: ['image/jpeg'], kind: 'image', format: 'jpeg' },
    png: { mime: ['image/png'], kind: 'image', format: 'png' },
    webp: { mime: ['image/webp'], kind: 'image', format: 'webp' },
    mp3: { mime: ['audio/mpeg'], kind: 'audio', format: 'mp3' },
    wav: { mime: ['audio/wav', 'audio/x-wav', 'audio/wave'], kind: 'audio', format: 'wav' },
    m4a: { mime: ['audio/mp4', 'audio/x-m4a'], kind: 'audio', format: 'mov' },
  };
  const match = formats[extension ?? ''];
  if (!match || match.kind !== kind || !match.mime.includes(mime))
    throw new MediaError('UNSUPPORTED_FILE_TYPE', 415);
  return match.format;
}
function magicMatches(data: Buffer, format: string) {
  if (format === 'jpeg') return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (format === 'png')
    return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (format === 'webp')
    return data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  if (format === 'wav')
    return data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WAVE';
  if (format === 'mp3')
    return (
      data.toString('ascii', 0, 3) === 'ID3' ||
      (data[0] === 0xff && ((data[1] ?? 0) & 0xe0) === 0xe0)
    );
  if (format === 'mov') return data.toString('ascii', 4, 8) === 'ftyp';
  return false;
}
function command(program: string, args: string[], timeout: number) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      program,
      args,
      {
        timeout,
        maxBuffer: 512 * 1024,
        killSignal: 'SIGKILL',
        env: { ...process.env, AV_LOG_FORCE_NOCOLOR: '1' },
      },
      (error, stdout) => {
        if (error) {
          // Missing tools are operational failures and may recover on a later worker attempt.
          if ('code' in error && error.code === 'ENOENT') reject(error);
          else reject(new MediaError('AUDIO_DECODE_FAILED'));
        } else resolve(stdout);
      },
    );
  });
}
type Probe = {
  streams?: {
    codec_type?: string;
    codec_name?: string;
    profile?: string;
    channels?: number;
    sample_rate?: string;
    duration?: string;
  }[];
  format?: { duration?: string };
};
async function probe(path: string, format: string) {
  const output = await command(
    process.env.FFPROBE_PATH ?? 'ffprobe',
    [
      '-v',
      'error',
      '-max_alloc',
      '67108864',
      '-protocol_whitelist',
      'file',
      '-f',
      format,
      ...(format === 'mov' ? ['-enable_drefs', '0', '-use_absolute_path', '0'] : []),
      '-i',
      path,
      '-show_streams',
      '-show_format',
      '-of',
      'json',
    ],
    20_000,
  );
  try {
    return JSON.parse(output) as Probe;
  } catch {
    throw new MediaError('AUDIO_DECODE_FAILED');
  }
}
function durationOf(value: Probe, max: number = mediaLimits.audioSeconds) {
  const duration = Number(value.format?.duration ?? value.streams?.[0]?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > max)
    throw new MediaError('AUDIO_DURATION_LIMIT');
  return duration;
}
/** Count decoded samples instead of trusting container duration or MP3 encoder padding. */
function transcode(args: string[]) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
    });
    let decodedBytes = 0,
      diagnosticBytes = 0;
    let failure: Error | undefined;
    const stop = (error: Error) => {
      failure ??= error;
      child.kill('SIGKILL');
    };
    const timeout = setTimeout(() => stop(new MediaError('AUDIO_DECODE_FAILED')), 120_000);
    child.stdio[3]!.on('data', (chunk: Buffer) => {
      decodedBytes += chunk.length;
      if (decodedBytes > mediaLimits.audioSeconds * 48000 * 2)
        stop(new MediaError('AUDIO_DURATION_LIMIT'));
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      diagnosticBytes += chunk.length;
      if (diagnosticBytes > 512 * 1024) stop(new MediaError('AUDIO_DECODE_FAILED'));
    });
    child.once('error', (error) => {
      failure ??= error;
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (failure) reject(failure);
      else if (code !== 0 || !decodedBytes || decodedBytes % 2 !== 0)
        reject(new MediaError('AUDIO_DECODE_FAILED'));
      else resolve(decodedBytes / (48000 * 2));
    });
  });
}
export type ProcessedMedia = {
  actualBytes: number;
  sha256: string;
  mime: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
};
/** Every output is regenerated from a successful decoder, not copied from client bytes. */
export async function processMedia(
  input: string,
  output: string,
  thumbnail: string | null,
  format: string,
  kind: 'image' | 'audio',
): Promise<ProcessedMedia> {
  const bytes = (await stat(input)).size;
  if (!bytes || bytes > (kind === 'image' ? mediaLimits.imageBytes : mediaLimits.audioBytes))
    throw new MediaError('FILE_SIZE_LIMIT');
  const hash = createHash('sha256');
  let first: Buffer = Buffer.alloc(0);
  for await (const chunk of createReadStream(input)) {
    const data = chunk as Buffer;
    if (!first.length) first = data.subarray(0, 32);
    hash.update(data);
  }
  if (!magicMatches(first, format)) throw new MediaError('FILE_SIGNATURE_MISMATCH', 415);
  const base = { actualBytes: bytes, sha256: hash.digest('hex') };
  try {
    if (kind === 'image') {
      const data = await readFile(input);
      const image = sharp(data, {
        limitInputPixels: 20_000_000,
        failOn: 'warning',
        animated: true,
      }).timeout({ seconds: 30 });
      const meta = await image.metadata();
      if (meta.format !== format) throw new MediaError('FILE_SIGNATURE_MISMATCH', 415);
      if ((meta.pages ?? 1) !== 1) throw new MediaError('ANIMATED_IMAGE_UNSUPPORTED', 415);
      if (
        !meta.width ||
        !meta.height ||
        meta.width > 10_000 ||
        meta.height > 10_000 ||
        meta.width * meta.height > 20_000_000
      )
        throw new MediaError('IMAGE_DIMENSION_LIMIT');
      const decoded = await image.autoOrient().png().toFile(output);
      if (thumbnail)
        await sharp(output)
          .timeout({ seconds: 30 })
          .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
          .png()
          .toFile(thumbnail);
      return {
        ...base,
        mime: 'image/png',
        width: decoded.width,
        height: decoded.height,
        durationSeconds: null,
      };
    }
    const metadata = await probe(input, format);
    const streams = metadata.streams ?? [];
    if (streams.length !== 1 || streams[0]?.codec_type !== 'audio')
      throw new MediaError('AUDIO_STREAM_UNSUPPORTED', 415);
    const stream = streams[0]!;
    const validCodec =
      format === 'mp3'
        ? stream.codec_name === 'mp3'
        : format === 'wav'
          ? /^pcm_(?:[su](?:8|16|24|32|64)(?:le|be)?|f(?:32|64)(?:le|be))$/.test(
              stream.codec_name ?? '',
            )
          : stream.codec_name === 'aac' && stream.profile === 'LC';
    if (!validCodec) throw new MediaError('AUDIO_CODEC_UNSUPPORTED', 415);
    if (!stream.channels || stream.channels > 2 || Number(stream.sample_rate) > 192000)
      throw new MediaError('AUDIO_STREAM_UNSUPPORTED', 415);
    // Probe cheaply rejects extreme lengths. Full decoded samples enforce the exact limit.
    durationOf(metadata, mediaLimits.audioSeconds + 1);
    const duration = await transcode([
      '-nostdin',
      '-v',
      'error',
      '-xerror',
      '-max_alloc',
      '67108864',
      '-threads',
      '1',
      '-filter_threads',
      '1',
      '-protocol_whitelist',
      'file',
      '-err_detect',
      'explode',
      '-f',
      format,
      ...(format === 'mov' ? ['-enable_drefs', '0', '-use_absolute_path', '0'] : []),
      '-i',
      input,
      '-map',
      '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-map_metadata',
      '-1',
      '-t',
      '601',
      '-threads',
      '1',
      '-c:a',
      'libmp3lame',
      '-q:a',
      '2',
      '-f',
      'mp3',
      '-y',
      output,
      '-map',
      '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-t',
      '601',
      '-ac',
      '1',
      '-ar',
      '48000',
      '-c:a',
      'pcm_s16le',
      '-f',
      's16le',
      'pipe:3',
    ]);
    durationOf(await probe(output, 'mp3'), mediaLimits.audioSeconds + 1);
    return { ...base, mime: 'audio/mpeg', width: null, height: null, durationSeconds: duration };
  } catch (error) {
    await Promise.all([
      rm(output, { force: true }),
      ...(thumbnail ? [rm(thumbnail, { force: true })] : []),
    ]);
    if (
      error instanceof MediaError ||
      ['ENOENT', 'EACCES', 'ENOSPC', 'EMFILE', 'EIO'].includes(
        String((error as { code?: string }).code),
      )
    )
      throw error;
    throw new MediaError(kind === 'image' ? 'IMAGE_DECODE_FAILED' : 'AUDIO_DECODE_FAILED');
  }
}
