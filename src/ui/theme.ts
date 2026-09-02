export const palette = {
  ink: '#090D0B',
  background: '#0D1310',
  surface: '#151D18',
  surfaceRaised: '#1C2720',
  border: '#2B3930',
  borderStrong: '#405346',
  text: '#F4F7F4',
  textMuted: '#9AA79E',
  textDim: '#68756D',
  accent: '#E8B84B',
  accentPressed: '#C99832',
  accentInk: '#171005',
  success: '#67C587',
  warning: '#F0A452',
  danger: '#EC716D',
  info: '#72A9DE',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
} as const;

export const typography = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '700' as const },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' as const },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '700' as const },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: '500' as const },
} as const;

