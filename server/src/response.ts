import type { Response } from 'express';

export function ok<T>(res: Response, data: T, message = 'ok') {
  return res.json({ code: 0, data, message });
}

export function fail(res: Response, message: string, code = 1, status = 200) {
  return res.status(status).json({ code, data: null, message });
}
