import React from 'react';
import { TextInput, TextInputProps, View } from 'react-native';
import { T } from './ui';
import { C, FONT, R } from '@/lib/theme';

export function Field({ label, hint, suffix, ...p }: TextInputProps & { label: string; hint?: string; suffix?: string }) {
  return (
    <View style={{ marginTop: 16 }}>
      <T size={13} w={700}>{label}</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: C.gray300, borderRadius: R.card, paddingHorizontal: 14, minHeight: 52 }}>
        <TextInput placeholderTextColor={C.gray500} accessibilityLabel={label} maxFontSizeMultiplier={1.6} {...p}
          style={[{ flex: 1, fontFamily: FONT[500], fontSize: 15, color: C.black, paddingVertical: 12 }, p.multiline && { minHeight: 88, textAlignVertical: 'top' }]} />
        {suffix ? <T size={14} w={600} color={C.gray500}>{suffix}</T> : null}
      </View>
      {hint ? <T size={12} color={C.gray500} style={{ marginTop: 6 }}>{hint}</T> : null}
    </View>
  );
}
