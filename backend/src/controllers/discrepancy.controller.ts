import type { FastifyReply, FastifyRequest } from 'fastify';
import { ValidationError } from '../lib/errors.js';
import * as discrepancyService from '../services/discrepancy.service.js';
import { sanitizeFileName } from '../services/evidence-storage.js';
import { getActor, requestContext } from '../utils/request-context.js';
import type {
  DiscrepancyAssignInput,
  DiscrepancyCommentInput,
  DiscrepancyCreateInput,
  DiscrepancyListQuery,
  DiscrepancyStatusChangeInput,
} from '../validators/discrepancy.schemas.js';

type IdParams = { Params: { id: string } };

export async function listDiscrepancies(request: FastifyRequest<{ Querystring: DiscrepancyListQuery }>) {
  return discrepancyService.listDiscrepancies(getActor(request), request.query);
}

export async function getDiscrepancy(request: FastifyRequest<IdParams>) {
  return discrepancyService.getDiscrepancy(getActor(request), request.params.id);
}

export async function createDiscrepancy(request: FastifyRequest<{ Body: DiscrepancyCreateInput }>, reply: FastifyReply) {
  const discrepancy = await discrepancyService.createDiscrepancy(getActor(request), request.body, requestContext(request));
  return reply.status(201).send(discrepancy);
}

export async function changeStatus(request: FastifyRequest<IdParams & { Body: DiscrepancyStatusChangeInput }>) {
  return discrepancyService.changeDiscrepancyStatus(getActor(request), request.params.id, request.body, requestContext(request));
}

export async function assign(request: FastifyRequest<IdParams & { Body: DiscrepancyAssignInput }>) {
  return discrepancyService.assignDiscrepancy(getActor(request), request.params.id, request.body.assignedToId, requestContext(request));
}

export async function comment(request: FastifyRequest<IdParams & { Body: DiscrepancyCommentInput }>) {
  return discrepancyService.commentDiscrepancy(getActor(request), request.params.id, request.body.note, requestContext(request));
}

export async function uploadEvidence(request: FastifyRequest<IdParams>, reply: FastifyReply) {
  const file = await request.file();
  if (!file) throw new ValidationError('Envie um arquivo no campo "file".');
  // Estoura com 413 se passar do limite configurado no plugin multipart.
  const buffer = await file.toBuffer();
  const evidence = await discrepancyService.addEvidence(getActor(request), request.params.id, { filename: file.filename, buffer }, requestContext(request));
  return reply.status(201).send(evidence);
}

export async function downloadEvidence(request: FastifyRequest<{ Params: { id: string; evidenceId: string } }>, reply: FastifyReply) {
  const file = await discrepancyService.getEvidenceFile(getActor(request), request.params.id, request.params.evidenceId);
  return reply
    .header('content-type', file.mimeType)
    // attachment: o navegador baixa em vez de renderizar (evita XSS via arquivo enviado).
    .header('content-disposition', `attachment; filename="${sanitizeFileName(file.fileName)}"`)
    .header('x-content-type-options', 'nosniff')
    .header('cache-control', 'private, no-store')
    .send(file.buffer);
}
