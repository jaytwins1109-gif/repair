import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { fail, ok } from '../response';
import {
  activateConfig,
  createConfig,
  deleteConfig,
  getLlmRuntime,
  listCalls,
  listConfigs,
  setDailyLimit,
  setLlmEnabled,
  testConfigById,
  updateConfig,
  type LlmConfigInput,
} from '../services/llm';

const router = Router();

router.get('/llm/configs', requireAuth, (_req, res) => {
  try {
    return ok(res, listConfigs());
  } catch (e: any) {
    return fail(res, e.message || '读取配置失败');
  }
});

router.post('/llm/configs', requireRole('engineer'), (req, res) => {
  try {
    const input: LlmConfigInput = {
      name: req.body?.name,
      platform: req.body?.platform,
      base_url: req.body?.base_url,
      api_key: req.body?.api_key,
      model: req.body?.model,
      temperature: req.body?.temperature,
      max_tokens: req.body?.max_tokens,
      enabled: req.body?.enabled,
    };
    return ok(res, createConfig(input), '配置已创建');
  } catch (e: any) {
    return fail(res, e.message || '创建配置失败');
  }
});

router.put('/llm/configs/:id', requireRole('engineer'), (req, res) => {
  try {
    const id = Number(req.params.id);
    const input: LlmConfigInput = {
      name: req.body?.name,
      platform: req.body?.platform,
      base_url: req.body?.base_url,
      api_key: req.body?.api_key,
      model: req.body?.model,
      temperature: req.body?.temperature,
      max_tokens: req.body?.max_tokens,
      enabled: req.body?.enabled,
    };
    return ok(res, updateConfig(id, input), '配置已保存');
  } catch (e: any) {
    return fail(res, e.message || '保存配置失败');
  }
});

router.delete('/llm/configs/:id', requireRole('engineer'), (req, res) => {
  try {
    return ok(res, deleteConfig(Number(req.params.id)), '配置已删除');
  } catch (e: any) {
    return fail(res, e.message || '删除配置失败');
  }
});

router.post('/llm/configs/:id/activate', requireRole('engineer'), (req, res) => {
  try {
    return ok(res, activateConfig(Number(req.params.id)), '已切换当前生效配置');
  } catch (e: any) {
    return fail(res, e.message || '切换配置失败');
  }
});

router.post('/llm/configs/:id/test', requireRole('engineer'), async (req, res) => {
  try {
    const result = await testConfigById(Number(req.params.id));
    if (result.ok) return ok(res, { ok: true, message: '连接成功，模型可用' }, '连接成功');
    return fail(res, result.message);
  } catch (e: any) {
    return fail(res, e.message || '测试连接失败');
  }
});

router.get('/llm/runtime', requireAuth, (_req, res) => {
  try {
    return ok(res, getLlmRuntime());
  } catch (e: any) {
    return fail(res, e.message || '读取模型状态失败');
  }
});

router.put('/llm/enabled', requireRole('engineer'), (req, res) => {
  try {
    const enabled = req.body?.enabled === true || req.body?.enabled === '1' || req.body?.enabled === 'true';
    return ok(res, setLlmEnabled(enabled), '已保存');
  } catch (e: any) {
    return fail(res, e.message || '保存失败');
  }
});

router.put('/llm/daily-limit', requireRole('engineer'), (req, res) => {
  try {
    return ok(res, setDailyLimit(Number(req.body?.limit)), '已保存');
  } catch (e: any) {
    return fail(res, e.message || '保存失败');
  }
});

router.get('/llm/calls', requireRole('engineer'), (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    return ok(res, listCalls(limit));
  } catch (e: any) {
    return fail(res, e.message || '读取调用日志失败');
  }
});

export default router;
