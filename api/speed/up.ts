export default async function handler(request: Request): Promise<Response> {
  const start = performance.now();

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let receivedBytes = 0;
  if (request.body) {
    const reader = request.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
    }
  }

  const serverDurationMs = Math.max(1, performance.now() - start);
  return Response.json(
    {
      receivedBytes,
      serverDurationMs: Number(serverDurationMs.toFixed(2)),
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}

export const config = {
  runtime: 'edge',
};
