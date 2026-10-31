import {apiRoute} from '../../../lib/api-route';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// Fallback only: worker.ts serves /api/* directly (skipping the Next.js runtime) to save Worker CPU time.
export const GET=apiRoute;export const POST=apiRoute;
