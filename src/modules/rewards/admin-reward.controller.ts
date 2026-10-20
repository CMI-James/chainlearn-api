// src/modules/rewards/admin-reward.controller.ts
import { FastifyRequest, FastifyReply } from 'fastify';
import { RewardService } from './reward.service.js';
import { DeductCreditsDto } from './dto/deduct-credits.dto.js';

const rewardService = new RewardService();

export async function deductCreditsHandler(
  req: FastifyRequest<{ Params: { id: string }; Body: DeductCreditsDto }>,
  reply: FastifyReply,
) {
  const userId = req.params.id;
  const adminId = (req as any).user?.id ?? 'mock-admin-id';
  const result = await rewardService.deductCredits(adminId, userId, req.body);

  return reply.send({
    success: true,
    message: 'Credits successfully deducted',
    data: result,
  });
}
