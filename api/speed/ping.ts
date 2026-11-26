export default function handler(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, no-transform',
    },
  });
}

export const config = {
  runtime: 'edge',
};
