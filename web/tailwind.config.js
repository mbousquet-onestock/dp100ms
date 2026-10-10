/** @type {import('tailwindcss').Config} */
// OneStock design tokens mapped to Tailwind (values are CSS variables from src/styles/tokens.css).
const v = (name) => `var(--${name})`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    screens: { sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px' },
    extend: {
      colors: {
        primary: { DEFAULT: v('primary-1000'), hover: v('primary-800'), 100: v('primary-100'), tint: v('primary-t-100') },
        neutral: {
          0: v('neutral-0'), 20: v('neutral-20'), 30: v('neutral-30'), 50: v('neutral-50'), 100: v('neutral-100'),
          150: v('neutral-150'), 200: v('neutral-200'), 300: v('neutral-300'), 500: v('neutral-500'), 700: v('neutral-700'),
          800: v('neutral-800'), 900: v('neutral-900'), 1000: v('neutral-1000'),
        },
        grey: { 700: v('grey-700'), 800: v('grey-800'), 900: v('grey-900'), 1000: v('grey-1000') },
        red: { DEFAULT: v('red-1000'), hover: v('red-800'), tint: v('red-t-100'), 100: v('red-100') },
        orange: { DEFAULT: v('orange-1000'), hover: v('orange-800'), tint: v('orange-t-100') },
        blue: { DEFAULT: v('blue-1000'), hover: v('blue-800'), tint: v('blue-t-100') },
        green: { DEFAULT: v('green-1000'), hover: v('green-800'), tint: v('green-t-100') },
        purple: { DEFAULT: v('purple-1000'), hover: v('purple-800'), tint: v('purple-t-100') },
        chrome: { DEFAULT: v('chrome-backoffice'), store: v('chrome-store-app') },
        border: { DEFAULT: v('border-primary'), error: v('border-error'), brand: v('border-brand') },
        text: { primary: v('text-primary'), secondary: v('text-secondary'), disabled: v('text-disabled'), grey: v('text-grey') },
        page: v('surface-page-background'),
      },
      spacing: { xs: '2px', s: '4px', m: '8px', l: '12px', xl: '16px', '2xl': '24px', '3xl': '32px' },
      borderRadius: { none: '0', s: '3px', m: '5px', l: '12px', round: '9999px', DEFAULT: '5px' },
      fontFamily: { sans: ['Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'], mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'] },
      fontSize: { '2xs': '10px', xs: '12px', s: '14px', m: '16px', l: '18px', xl: '20px', '2xl': '22px', '3xl': '32px', '4xl': '36px' },
      boxShadow: { floating: v('shadow-floating-container'), 'floating-button': v('shadow-floating-button'), none: 'none' },
      height: { control: '36px', topbar: '48px' },
    },
  },
  plugins: [],
};
