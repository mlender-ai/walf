// Expo 푸시 서비스로 보낸다. 토큰이 없으면 보내지 않고, 결과는 notifications.push_status 에 사실대로 남긴다.
export async function sendPush(token: string, title: string, body: string, data: Record<string, unknown>): Promise<{ ok: boolean; detail: string; unregistered?: boolean }> {
  if (process.env.WALF_PUSH_DISABLED === '1') return { ok: false, detail: '서버 설정으로 푸시 발송 꺼짐' };
  if (!/^ExponentPushToken\[.+\]$/.test(token)) return { ok: false, detail: 'Expo 푸시 토큰 형식이 아님' };
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ to: token, title, body, data, sound: 'default' }),
    signal: AbortSignal.timeout(8000),
  });
  const json: any = await res.json().catch(() => ({}));
  const ticket = Array.isArray(json?.data) ? json.data[0] : json?.data;
  if (res.ok && ticket?.status === 'ok') return { ok: true, detail: `ticket ${ticket.id}` };
  if (ticket?.details?.error === 'DeviceNotRegistered') return { ok: false, unregistered: true, detail: 'DeviceNotRegistered — 앱이 지워졌거나 토큰이 만료됨' };
  return { ok: false, detail: `HTTP ${res.status} ${JSON.stringify(ticket?.details || ticket?.message || json?.errors || '').slice(0, 200)}` };
}
