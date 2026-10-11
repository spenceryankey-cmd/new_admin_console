/** BeyondX palette, taken from the main site and the old admin console. */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: {
          50: '#f6f6f4', 100: '#e8e8e4', 200: '#cfcfc9', 300: '#a8a8a0', 400: '#7c7c74',
          600: '#3a4235', 700: '#2a3226', 800: '#1e2419', 900: '#12180e', 950: '#0d0d0b',
        },
        forest: {
          50: '#f0f7f0', 100: '#dcecdc', 300: '#a6d96a', 400: '#8bc53f', 500: '#7bbb2e',
          600: '#6bab21', 700: '#578c1a', 800: '#446d14', 900: '#33520f',
        },
        clay: { 100: '#f5e9d8', 200: '#e8d2ae', 400: '#c79553', 600: '#8f6128' },
        danger: { 200: '#fecaca', 400: '#f87171', 600: '#dc2626', 700: '#b91c1c' },
      },
    },
  },
  plugins: [],
}
