import { router } from 'expo-router';

/** 서버 알림의 link(walf://…)와 상태 문장의 action.target 을 화면 이동으로 바꾼다 */
export function openLink(link?: string | null) {
  if (!link) return;
  let m: RegExpMatchArray | null;
  if ((m = link.match(/^walf:\/\/candidate\/(\d+)/)) || (m = link.match(/^candidate:(\d+)/))) return router.push(`/candidate/${m[1]}`);
  if (/^walf:\/\/request\/\d+\/wanted/.test(link) || /^wanted:/.test(link)) return router.push('/request/wanted');
  if (/^walf:\/\/request\/\d+\/info/.test(link) || /^info:/.test(link)) return router.push('/request/info');
  if ((m = link.match(/^walf:\/\/request\/(\d+)/)) || (m = link.match(/^tracking:(\d+)/))) return router.push({ pathname: '/past/[id]', params: { id: m[1] } });
}
