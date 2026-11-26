const RANDOM_POOL_SIZE = 1024 * 1024;
const CHUNK_SIZE = 64 * 1024;

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get('bytes'));
  const totalBytes = Number.isFinite(requested)
    ? Math.max(1024, Math.min(50 * 1024 * 1024, Math.floor(requested)))
    : 10 * 1024 * 1024;

  const randomPool = crypto.getRandomValues(new Uint8Array(RANDOM_POOL_SIZE));
  let sent = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const remaining = totalBytes - sent;
      if (remaining <= 0) {
        controller.close();
        return;
      }

      const length = Math.min(CHUNK_SIZE, remaining);
      const offset = sent % (RANDOM_POOL_SIZE - CHUNK_SIZE);
      controller.enqueue(randomPool.slice(offset, offset + length));
      sent += length;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(totalBytes),
      'Cache-Control': 'no-store, no-cache, must-revalidate, no-transform',
      'Timing-Allow-Origin': '*',
    },
  });
}

export const config = {
  runtime: 'edge',
};
