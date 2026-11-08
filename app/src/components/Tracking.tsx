import React, { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { Btn, CandRow, Gap, Hair, Icon, MockBanner, MockPill, ProductImage, Section, T, Tag, TextBtn } from './ui';
import { ActRow } from './Home';
import { TAB_SPACE } from './TabBar';
import { C, R } from '@/lib/theme';
import { call } from '@/lib/api';
import type { RequestView } from '@/lib/types';

const POST_LABEL: Record<string, string> = {
  queued: '게시 준비 중', posted: '게시', skipped: '올리지 않았어요', rejected: '플랫폼에서 거절·삭제', removal_requested: '삭제 요청됨', removed: '삭제함', cancelled: '게시 전 철회',
};

/** S05 추적함 — 활성 의뢰와 지난 의뢰가 같은 구성을 쓴다 */
export function TrackingView({ r, onChange, refreshing, onRefresh }: { r: RequestView; onChange: () => void; refreshing?: boolean; onRefresh?: () => void }) {
  const open = ['submitted', 'needs_info', 'active'].includes(r.status);
  const found = [...r.candidates.offers, ...r.candidates.leads, ...r.candidates.priceWatch];
  const [showMis, setShowMis] = useState(true);
  const [busy, setBusy] = useState(false);
  const groups = r.activity.reduce<{ g: string; items: typeof r.activity }[]>((acc, a) => {
    const last = acc[acc.length - 1]; if (last && last.g === a.group) last.items.push(a); else acc.push({ g: a.group, items: [a] }); return acc;
  }, []);

  const act = (title: string, msg: string, ok: string, path: string, destructive = true) => Alert.alert(title, msg, [
    { text: '아니요', style: 'cancel' },
    { text: ok, style: destructive ? 'destructive' : 'default', onPress: async () => {
      setBusy(true);
      try { await call('POST', path); onChange(); } catch (e: any) { Alert.alert('처리하지 못했어요', e.message); } finally { setBusy(false); }
    } },
  ]);

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: TAB_SPACE }} refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.black} /> : undefined}>
      <View style={{ paddingHorizontal: 20 }}>
        {r.isMock ? <MockBanner /> : null}
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center', marginTop: 6 }}>
          <ProductImage uri={r.product.photoUrl} style={{ width: 64, height: 76, borderRadius: R.thumb }} label="의뢰한 옷" compact />
          <View style={{ flex: 1 }}>
            {r.product.brandLabel ? <T size={11.5} w={800} ls={0.5} numberOfLines={1}>{r.product.brandLabel.toUpperCase()}</T> : null}
            <T size={16} w={600} lh={22} numberOfLines={2} style={{ marginTop: 2 }}>{r.product.title}</T>
            <T size={12.5} color={C.gray500} style={{ marginTop: 4 }}>{r.schedule.startedLabel ? `${r.schedule.startedLabel} · ${r.schedule.endsLabel}` : `${r.createdLabel} 접수 · 7일 시작 전`}</T>
          </View>
        </View>
        {!open ? <View style={s.ended}><T size={14} w={700}>{r.display.title}</T><T size={12.5} color={C.gray500}>{r.display.eyebrow}</T></View> : null}
        {r.schedule.days.length ? (
          <View style={s.cal} accessibilityLabel={`7일 중 ${r.schedule.day}일째`}>
            {r.schedule.days.map(d => {
              const on = d.today;
              return (
                <View key={d.day} style={[s.calD, on && { backgroundColor: C.black }]}>
                  <T size={11} w={700} color={on ? '#bdbdbd' : C.gray500} max={1.2} lh={13}>{String(d.day).padStart(2, '0')}</T>
                  <T size={15} w={d.state === 'upcoming' || d.state === 'pending' ? 500 : 700} color={on ? C.white : d.state === 'upcoming' ? C.gray500 : C.black} max={1.2} lh={19}>{d.date}</T>
                  <View style={[s.dot, d.state === 'done' && { backgroundColor: on ? C.white : C.black, borderWidth: 0 }, d.state === 'missed' && { borderColor: on ? C.white : C.black, borderWidth: 1.6 }]} />
                </View>
              );
            })}
          </View>
        ) : null}
        {r.schedule.days.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            <View style={[s.dot, { backgroundColor: C.black, borderWidth: 0 }]} /><T size={11.5} w={500} color={C.gray500}>탐색 완료</T>
            <View style={[s.dot, { marginLeft: 6, borderColor: C.black, borderWidth: 1.6 }]} /><T size={11.5} w={500} color={C.gray500}>하지 못함</T>
            <View style={[s.dot, { marginLeft: 6 }]} /><T size={11.5} w={500} color={C.gray500}>예정</T>
            <T size={11.5} w={500} color={C.gray500} style={{ marginLeft: 'auto' }}>하루 한 번 · 국내 판매처</T>
          </View>
        ) : <View style={{ height: 20 }} />}
      </View>
      <Gap />
      <Section title="발견한 매물" sub={String(found.length)}>
        {found.length ? found.map(c => <CandRow key={c.id} c={c} onPress={() => router.push(`/candidate/${c.id}`)} />)
          : <T size={13.5} color={C.gray500} style={{ marginTop: 10 }}>{r.schedule.lastRun ? '조건에 맞는 매물은 아직 없어요.' : '첫 탐색이 끝나면 여기에 보여드려요.'}</T>}
        {r.candidates.mismatches.length ? (
          <View style={{ marginTop: 16 }}>
            <Pressable onPress={() => setShowMis(v => !v)} accessibilityRole="button" accessibilityState={{ expanded: showMis }} style={{ minHeight: 44, justifyContent: 'center' }}>
              <T size={13.5} w={700}>확인했지만 조건이 맞지 않았어요 <T size={13.5} w={700} color={C.gray500}>{r.candidates.mismatches.length}</T></T>
            </Pressable>
            {showMis ? r.candidates.mismatches.map((c, i) => (
              <View key={c.id} style={[s.mis, i ? { borderTopWidth: 1, borderTopColor: C.surface } : null]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><T size={14} w={600} style={{ flex: 1 }} numberOfLines={1}>{[c.seller, c.size, c.priceLabel].filter(Boolean).join(' · ')}</T><Tag t={c.dismissed ? { kind: 'x', text: '넘김' } : (c.tags[1] || c.tags[0])} /></View>
                <T size={12.5} color={C.gray500}>{c.dismissed ? '내가 넘긴 매물이에요' : [c.tags[0]?.text, ...c.reasons].filter(Boolean).join(' · ')}</T>
              </View>
            )) : null}
          </View>
        ) : null}
      </Section>
      <Gap />
      <Section title="구매 조건" right={open ? '수정' : undefined} onRight={open ? () => router.push('/request/conditions') : undefined}>
        {[['사이즈', r.conditions.size || '정하지 않음'], ['색상', r.conditions.color || '상관없음'],
          ['희망가', r.conditions.maxPrice ? `${r.conditions.maxPrice.toLocaleString('ko-KR')}원 이하 · 배송비 포함` : '정하지 않음'], ['중고', r.conditions.usedOk ? '괜찮아요' : '새 상품만']]
          .map(([k, v]) => <View key={k} style={{ flexDirection: 'row', paddingVertical: 9 }}><T size={14} color={C.gray500} style={{ width: 64 }}>{k}</T><T size={14} w={600} style={{ flex: 1 }}>{v}</T></View>)}
        <T size={12} color={C.gray500} style={{ marginTop: 6 }}>{!r.conditions.size && !r.conditions.maxPrice ? '조건이 없으면 “조건에 맞는 매물” 알림이 부정확할 수 있어요. ' : ''}조건을 바꾸면 다음 탐색부터 적용돼요.</T>
      </Section>
      <Gap />
      <Section title="공개 수배" right={r.wanted?.status === 'proposed' && open ? '수배지 미리보기' : undefined} onRight={() => router.push('/request/wanted')}>
        {!r.wanted ? <T size={13.5} color={C.gray500} style={{ marginTop: 8 }}>첫 탐색에서 조건에 맞는 매물이 없으면, 공개 수배를 할지 물어볼게요. 동의 없이 공개하지 않아요.</T>
          : r.wanted.status === 'proposed' ? <View style={{ marginTop: 8 }}><T size={13.5} w={600}>수배 여부를 정해 주세요.</T><Btn label="수배지 미리보기" small onPress={() => router.push('/request/wanted')} style={{ alignSelf: 'flex-start', marginTop: 12 }} /></View>
          : r.wanted.status === 'declined' ? <T size={13.5} color={C.gray500} style={{ marginTop: 8 }}>공개하지 않고 비공개로 찾고 있어요.</T>
          : <>
            <T size={13.5} w={600} style={{ marginTop: 8 }}>{r.wanted.status === 'withdrawn' ? '수배를 내렸어요 · 게시글 삭제를 요청했어요' : r.wanted.posts.some(p => p.status === 'posted') ? '공개 수배 중' : '게시 준비 중 — 아직 올라가지 않았어요'}</T>
            {r.wanted.posts.map(p => (
              <View key={p.id} style={s.post}>
                <T size={13.5} w={700} color={['skipped', 'rejected', 'cancelled'].includes(p.status) ? C.gray500 : C.black} style={{ width: 86 }}>{p.channel}</T>
                <View style={{ flex: 1 }}><T size={12.5} color={p.status === 'posted' ? C.black : C.gray500}>{POST_LABEL[p.status] || p.status}{p.postedLabel && p.status === 'posted' ? ` · ${p.postedLabel}` : ''}</T>
                  {p.reason && p.status !== 'posted' ? <T size={12} color={C.gray500}>{p.reason}</T> : null}{p.isMock ? <MockPill style={{ marginTop: 3 }} /> : null}</View>
                {p.url ? <Pressable onPress={() => Linking.openURL(p.url!)} accessibilityRole="link" accessibilityLabel={`${p.channel} 게시글 열기`} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 }}><Icon name="ext" size={18} /></Pressable> : null}
              </View>
            ))}
            {r.wanted.status === 'approved' && open ? <TextBtn label="수배 내리기" onPress={() => act('수배를 내릴까요?', '게시된 수배지는 왈프 팀이 삭제해요. 비공개 탐색은 계속돼요.', '내리기', `/requests/${r.id}/wanted/withdraw`)} /> : null}
          </>}
      </Section>
      <Gap />
      <Section title="확인한 판매처" sub={r.sellers?.label}>
        {r.sellers ? <>
          {r.sellers.isMock ? <MockPill style={{ marginTop: 8 }} /> : null}
          {r.sellers.items.map((x, i) => (
            <View key={x.name} style={[{ flexDirection: 'row', paddingVertical: 10 }, i ? { borderTopWidth: 1, borderTopColor: C.surface } : { marginTop: 6 }]}>
              <T size={13.5} w={600} style={{ width: 96 }}>{x.name}</T><T size={13} color={x.status === 'unreachable' ? C.black : C.gray500} w={x.status === 'unreachable' ? 600 : 400} style={{ flex: 1 }}>{x.text}</T>
            </View>
          ))}
          <T size={12} color={C.gray500} style={{ marginTop: 10 }}>가격과 재고를 직접 확인한 곳만 보여드려요. 접속하지 못한 곳은 매물이 없다는 뜻이 아니에요.</T>
        </> : <T size={13.5} color={C.gray500} style={{ marginTop: 8 }}>아직 탐색 기록이 없어요.</T>}
      </Section>
      <Gap />
      <Section title="활동 일지" sub="실제 기록만 남겨요">
        {groups.map(g => (
          <View key={g.g}>
            <T size={12} w={800} ls={0.2} style={{ marginTop: 14, marginBottom: 2 }}>{g.g}</T>
            {g.items.map((a, i) => <View key={a.id}>{i ? <Hair /> : null}<ActRow a={a} /></View>)}
          </View>
        ))}
      </Section>
      {open ? (
        <View style={{ alignItems: 'center', paddingTop: 8, paddingHorizontal: 20 }}>
          <TextBtn label="의뢰 그만두기" onPress={() => act('의뢰를 그만둘까요?', '탐색을 멈추고, 올린 수배지는 삭제를 요청해요. 되돌릴 수 없어요.', '그만두기', `/requests/${r.id}/cancel`)} />
          <T size={12} color={C.gray500} style={{ marginTop: -4, textAlign: 'center' }}>그만두면 탐색을 멈추고, 올린 수배지 삭제를 요청해요.</T>
          {busy ? <T size={12} color={C.gray500}>처리 중…</T> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  cal: { flexDirection: 'row', gap: 4, marginTop: 20 },
  calD: { flex: 1, alignItems: 'center', gap: 3, paddingTop: 8, paddingBottom: 10, borderRadius: 10 },
  dot: { width: 7, height: 7, borderRadius: 4, borderWidth: 1.2, borderColor: C.gray300, marginTop: 2 },
  mis: { paddingVertical: 12, gap: 2 },
  post: { flexDirection: 'row', alignItems: 'center', minHeight: 46, borderTopWidth: 1, borderTopColor: C.surface, paddingVertical: 4 },
  ended: { marginTop: 16, padding: 14, borderRadius: R.card, borderWidth: 1, borderColor: C.gray300, gap: 2 },
});
