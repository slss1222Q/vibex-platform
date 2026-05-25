/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#000000',
          900: '#080808',
          850: '#0d0d0d',
          800: '#121212',
          700: '#1c1c1e',
        },
        coin: '#f5c451',
        telegram: '#2aabee',
      },
      boxShadow: {
        glow: '0 0 40px rgba(245, 196, 81, 0.2)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
